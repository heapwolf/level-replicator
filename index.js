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

  if (options.multicast) {
    peerManager(options);
  }

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

  var intervals = connect(db, options, writes, function(conn, host, port) {

    var remote = cs.createClient(conn);

    db.emit('connect', host, port);

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
          getRemoteLogs(remote, peers, history, function(err, remote_logs, id) {
            if (err) return db.emit('error', err);
            parseLogs(remote, remote_logs, host, port, id);
          });
        });
      });
    });
  });

  function parseLogs(remote, remote_logs, host, port, id) {

    var ops = [];
    var count = remote_logs.length;

    function write() {
      batch.call(db, ops, function(err) {
        if (err) db.emit('error', err);
      });
    }

    //console.log(require('util').inspect(info, { depth: null }));
    remote_logs.forEach(function(remote_log) {

      // get the most recent local log.
      var indexkey = sublevels.index + remote_log.value.key;
      var remote_key = remote_log.key;
      remote_log = remote_log.value; // just make the objects look the same :P
      
      db.get(indexkey, function(err, index) {
        if (err && !err.notFound) return db.emit('error', err);

        index = index || '\xff'; // fool levelup into continuing even without a key.

        db.get(index, function(err, local_log) {
          if (err && !err.notFound) return db.emit('error', err);

          // get the remote value for the key
          remote.get(remote_log.key, function(err, remote_value) {

            // if the remote key is more recent or we don't have it...
            if (!local_log || remote_log.clock > local_log.clock) {

              var nextkey = instance_id + '!' + remote_log.sequence;

              // clear our index???
              ops.push({ type: 'del', key: index });
              // create a new log
              ops.push({ type: 'put', key: sublevels.log + nextkey, value: remote_log });
              // create a new index
              ops.push({ type: 'put', key: sublevels.index + remote_log.key, value: remote_log });
              // capture the new key/value with the appropriate type
              ops.push({ type: remote_log.type, key: remote_log.key, value: remote_value });
            }

            // create a history entry
            ops.push({ type: 'put', key: sublevels.history + id, value: remote_key });
            // write to the local store
            write();
          });
        });
      });
    });
  }

  function getRemotePeers(remote, cb) {

    var peers = [];
    var error;

    remote.createReadStream({
      values: false,
      start: sublevels.peers,
      end: sublevels.peers + '~'
    }).on('error', function(err) {
      error = err;
    }).on('data', function(id) {
      peers.push(id.replace(sublevels.peers, ''));
    }).on('end', function() {
      if (error) return cb(error);
      cb(null, peers);
    });
  }

  function getRemoteLogs(remote, peers, history, cb) {

    remote.identifyPeer(function(err, peerId) {

      peers.push(peerId);

      // we don't need to ask about our own logs.
      //var selfref = peers.indexOf(instance_id);
      //if (selfref > 0) {
      //  peers.splice(selfref, 1);
      //}

      var count = peers.length;
      var remote_logs = [];

      peers.forEach(function(id) {

        var error;

        if (id == instance_id) {
          return --count;
        }

        var last_seen = history[sublevels.history + id];
        var key = sublevels.log + id;

        //
        // if we don't have history we can set the upper
        // bound to be the start of the range.
        //
        if (!last_seen) {
          last_seen = key + '!';
        }

        remote.createReadStream({
          reverse: true,
          gt: last_seen,
          lt: key + '!~'
        }).on('error', function(err) {
          error = err;
        }).on('data', function(d) {
          remote_logs.push(d);
        }).on('end', function() {
          if (--count == 0) {
            if (error) return cb(error);

            cb(null, remote_logs, id);
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
    db.batch([{ type: 'del', key: key }], cb);
  };

  db.batch = function(ops, cb) {

    writes.last_velocity = writes.velocity += ops.length;

    var error;
    var counter = ops.length;
    var meta = [];

    ops.forEach(function(op) {

      var indexkey = sublevels.index + op.key

      db.get(indexkey, function(err, record) {
        if (err && !err.notFound) return error = err;
        
        if (record) {
          var oldlog = sublevels.log + instance_id + '!' + record.sequence;
          meta.push({ type: 'del', key: oldlog });
        }
        else {
          record = { clock: 0 };
        }

        sequence = seqlex(sequence);

        record.sequence = sequence;
        record.clock++;
        record.type = op.type;
        record.key = op.key;

        var logkey = sublevels.log + instance_id + '!' + sequence;

        meta.push({ type: 'put', key: indexkey, value: record });
        meta.push({ type: 'put', key: logkey, value: record });

        if (--counter == 0) {
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

