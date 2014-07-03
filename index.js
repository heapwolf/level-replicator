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
    history: sep + '__history__' + sep
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

    conn.setNoDelay(true);
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

    //
    // write the data and end the converation.
    //
    function write() {
      batch.call(db, ops, function(err) {
        if (err) db.emit('error', err);
        //remote.destroy();
      });
    }

    Object.keys(remote_logs).forEach(function(remote_logkey) {

      var remote_log = remote_logs[remote_logkey];
      var remote_index = sublevels.index + remote_log.key;
  
      db.get(remote_index, function(err, index) {

        index = index || '\xff'; // fool levelup into continuing even without a key.

        db.get(index, function(err, local_log) {

          remote.get(remote_log.key, function(err, remote_value) {

            // determine if we want it
            if (!local_log || remote_log.clock > local_log.clock) {

              //ops.push({ type: 'del', key: sublevels.log + instance_id +'!'+ remote_log.sequence });

              // get the actual data and apply the correct type
              ops.push({ type: remote_log.type, key: remote_log.key, value: remote_value });

              remote_log.sequence = seqlex(remote_log.sequence);

              // create an index
              ops.push({ type: 'put', key: sublevels.index + remote_log.key, value: remote_log });

              // create a new log
              var newkey = sublevels.log + instance_id + '!' + seqlex(sequence);
              ops.push({ type: 'put', key: newkey, value: remote_log });
            }

            // create a history entry
            ops.push({ type: 'put', key: sublevels.history + id, value: remote_logkey });
            write();
          });
        });
      });
    });
  }

  function getRemotePeers(remote, cb) {

    remote.identifyPeer(function(err, peerId) {

      var peers = [];
      var error;

      peers.push(peerId);

      remote.createReadStream({
        values: false,
        start: sublevels.peers,
        end: sublevels.peers + '~'
      }).on('error', function(err) {
        error = err;
      }).on('data', function(id) {
        // we dont need to read logs that the peer has
        // gathered from us, that would be a waste of time.
        if (id == instance_id) return;
        // push just the id into the array.
        peers.push(id.replace(sublevels.peers, ''));
      }).on('end', function() {
        if (error) return cb(error);
        cb(null, peers);
      });
    });
  }

  function getRemoteLogs(remote, peers, history, cb) {

    var count = 0;
    var error;
    var remote_logs = {};

    //
    // get all the logs for all the peers
    //
    peers.forEach(function(id) {

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
      }).on('data', function(log) {
        remote_logs[log.key] = log.value;
      }).on('end', function() {
        if (++count == peers.length) {
          if (error) return cb(error);
          cb(null, remote_logs, id);
        }
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

        //
        // increase local write sequence so that when a remote sequence is
        // added it comes in order after any local write has been made.
        //
        sequence = seqlex(sequence);

        record.sequence = seqlex(seqlex(record.sequence));
        record.clock++;
        record.type = op.type;
        record.key = op.key;

        var logkey = sublevels.log + instance_id + '!' + record.sequence;

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

