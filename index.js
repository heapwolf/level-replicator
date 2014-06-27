/*
 *
 * index.js
 * responsible for over-riding database opertions, accepting 
 * and parsing logs to determine which values to exchange.
 *
 */

var getId = require('./lib/id');
var peerManager = require('./lib/peers');
var connect = require('./lib/connect');
var cs = require('./lib/client-server');

var seqlex = require('seq-lex');

module.exports = function replicator(db, options) {

  options = options || {};
  options.port = options.port || 9000;
  options.host = options.host || '127.0.0.1';
  options.peers = options.peers || {};

  peerManager(options);

  var server = cs.createServer(db, options);
  var sequence = seqlex(); // TODO: persist to disk
  var sep = db.sep || '\xff';
  var instance_id = options.id || getId();

  sublevels = {
    log: sep + '__log__' + sep,
    index: sep + '__log_index__' + sep,
    peers: sep + '__peers__' + sep,
    history: sep + '__history__' + sep,
    conflicts: sep + '__conflicts__' + sep
  };

  var put = db.put;
  var batch = db.batch;
  var del = db.del;
  var close = db.close;

  var writes = {
    velocity: 0,      // the write velocity
    ticks: 0,         // how many ticks pass while the write velocity is constant
    last_velocity: 0  // the last known write velocity after the interval passes
  };

  var intervals = connect(options, writes, function(conn, host, port) {

    var remote = cs.createClient(conn);

    db.emit('connect', host, port);

    //console.log(options.host, options.port, '->', host, port)

    //
    // Introduce ourselves to the remote peer (overwrites).
    //
    remote.addPeer(instance_id, function(err) {
      if (err) return db.emit('error', err);

      //
      // Find out who else is replicating to this peer.
      //
      getRemotePeers(remote, function(err, peers) {

        //
        // Prepare what we already know about each peer
        //
        getLocalHistory(function(err, history) {
          if (err) return db.emit('error', err);

          //
          // for each peer that the remote knows about, read the sequential
          // logs in reverse until the last_seen log appears, then parse the
          // new logs.
          //
          getRemoteLogs(remote, peers, history, function(err, remote_logs) {
            if (err) return db.emit('error', err);
            parseLogs(remote, remote_logs, host, port);
          });
        });
      });
    });
  });

  function parseLogs(remote, remote_logs, host, port) {

    console.log(options.host, options.port, '->', host, port)
    //
    // 
    //
    var ops = [];
    var count = remote_logs.length;

    function write() {
      batch.call(db, ops, function(err) {
        if (err) db.emit('error', err);
      });
    }

    console.log(remote_logs)

    remote_logs.forEach(function(remote_log) {

      //
      // check if we already have the remote log, determine if we 
      // want the log and its data.
      //
      db.get(remote_log.key, function(err, local_log) {
        if (err && !err.notFound) return db.emit('error', err);
        else if (err) {
          local_log = {
            value: { clock: 0, sequence: String.fromCharCode(33) }
          };
        }

        if (local_log.value  && remote_log.value) {
          if (local_log.clock > remote_log.value.clock) return;
        }

        //
        // we want to store the remote value and the remote log
        //
        remote.get(remote_log.value.key, function(err, remote_value) {
          if (err) return db.emit('error', err);

          // save the data to the local database
          ops.push({ type: 'put', key: remote_log.value.key, value: remote_value });

          // this could be a little cleaner...
          var key = remote_log.key.replace(sublevels.log, '');
          var peerId = key.substr(0, key.indexOf('!'));
          var historykey = sublevels.history + peerId;
          ops.push({ type: 'put', key: historykey, value: key });

          // save the log to the local database
          remote_log.type = 'put';
          ops.push(remote_log);

          write();
        });
      });

    });
  }

  function getRemotePeers(remote, cb) {

    var peers = [];
    var error;

    remote.createReadStream({
      start: sublevels.peers,
      end: sublevels.peers + '~'
    }).on('error', function(err) {
      error = err;
    }).on('data', function(d) {
      peers.push(d);
    }).on('end', function() {
      if (error) return cb(error);
      cb(null, peers);
    });
  }

  function getRemoteLogs(remote, peers, history, cb) {

    remote.identifyPeer(function(err, peerId) {

      peers.push({ key: peerId });

      var count = peers.length;
      var remote_logs = [];

      peers.forEach(function(peer) {

        var error;
        var id = peer.key.replace(sublevels.peers, '');

        if (id == instance_id) {
          return --count;
        }

        var last_seen = history[sublevels.history + id];
        var key = sublevels.log + id;

        //
        // if we have history, use it as the upper bound
        // if we don't we can set the upper bound to be
        // the end of the range.
        //
        if (last_seen) {
          last_seen = sublevels.log + last_seen;
        }
        else {
          last_seen = key;
        }

        remote.createReadStream({
          reverse: true,
          lte: key + '~', // last_seen,
          gt: last_seen
        }).on('error', function(err) {
          error = err;
        }).on('data', function(d) {
          remote_logs.push(d);
        }).on('end', function() {
          if (--count == 0) {
            if (error) return cb(error);
            cb(null, remote_logs);
          }
        });
      });
    });
  }

  function getLocalHistory(cb) {

    var error;
    var history = {};

    db
      .createReadStream({
        start: sublevels.history,
        end: sublevels.history + '~'
      }).on('error', function(err) {
        error = err;
      }).on('data', function(r) {
        history[r.key] = r.value;
      }).on('end', function() {
        if (!error) cb(null, history);
        else cb(error);
      });
  }

  db.methods = db.methods || {};
  db.methods['addPeer'] = { type: 'async' };
  db.methods['identifyPeer'] = { type: 'async' };

  db.addPeer = function(id, cb) {
    put.call(db, sublevels.peers + id, Date.now(), cb);
  };

  db.identifyPeer = function(cb) {
    cb(null, instance_id);
  };

  db.put = function(key, value, options, cb) {

    if (typeof options == 'function') {
      cb = options;
      options = {};
    }
    // this item is just being replicated...
    if (options.replicated) {
      return put.call(db, key, value, options, cb);
    }

    var op = { type: 'put', key: key, value: value };
    if (options.keyEncoding) op.keyEncoding = options.keyEncoding;
    if (options.valueEncoding) op.valueEncoding = options.valueEncoding;

    db.batch([op], cb);
  };

  db.del = function(key, options, cb) {

    if (typeof options == 'function') {
      cb = options;
      options = {};
    }

    // this item is just being replicated...
    if (options.replicated) {
      return del.call(db, key, cb);
    }

    db.batch([{ type: 'del', key: key }], cb);
  };

  db.batch = function(ops, cb) {

    writes.last_velocity = writes.velocity += ops.length;

    var error;
    var counter = ops.length;
    var meta = [];

    ops.forEach(function(op) {

      db.get(sublevels.index + op.key, function(err, record) {
        if (err && !err.notFound) return error = err;
        else if (err) {
          record = { clock: 0, sequence: 0 };
        }
        else {
          var oldkey = sublevels.log + instance_id + '!' + record.sequence;
          meta.push({ type: 'del', key: oldkey });
        }

        sequence = seqlex(sequence); // increment the locally global sequence
        record.sequence = sequence; // assign new sequence
        record.clock++; // increment the clock
        record.key = op.key;

        // LOG INDEX: construct read/write optimized lookup and log pair
        var logkey = sublevels.log + instance_id + '!' + sequence;
        var indexkey = sublevels.index + op.key;
        meta.push({ type: 'put', key: logkey, value: record });
        meta.push({ type: 'put', key: indexkey, value: logkey });

        if (--counter == 0) {
          if (error) return cb(error);
          batch.call(db, ops.concat(meta), cb);
        }
      });
    });
  };

  // TODO: possibly overwrite createReadStream to hide internal sublevels.

  db.close = function() {
    server.close();
    clearInterval(intervals.loop);
    clearInterval(intervals.chrono);
    close.apply(db, arguments);
  };

  return db;
}

