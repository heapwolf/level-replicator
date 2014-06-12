var net = require('net');
var multilevel = require('multilevel');

var prefix = '\xff__changes__\xff';

exports.server = function server(db, options) {

  if (db.sep) { // prefer sublevel's delimiter
    prefix = db.sep + '__changes__' + db.sep;
  }

  var test = options.test;

  var put = db.put;
  var batch = db.batch;
  var del = db.del;
  var close = db.close;

  var write_velocity = 0;
  var last_write = { velocity: 0, ticks: 0 };
  var connect_velocity = 100;
  var connection = 0;
  var port = options.port || 9000;
  var host = (options.host || '127.0.0.1');
  var servers = options.servers || [];

  var server = net.createServer(function (con) {
    con.pipe(multilevel.server(db, options)).pipe(con);
  });

  server.listen(port, function() {
    db.emit('listening');
  });

  server.on('connection', function() {
    db.emit('connection');
  });

  server.on('error', function (err) {
    db.emit('error', err);
  });

  db.on('add', function(address) {
    options.servers.push(address);
  });

  function parse_logs(dbc, _logs, _port, _host) {

    console.log(host, port, ' -> ', _host, _port);

    var remote_logs = {};
    var ops = [];
    var count = 0;

    // reduce logs to just those who have the lastest clock
    //
    // since logs are sequential and we have received them
    // in reverse, the first of each willl be the highest.
    //
    _logs.forEach(function(log) {
      if (!remote_logs[log.value.key]) {
        remote_logs[log.value.key] = log;
      }
    });

    //
    // determine how to handle each remote log.
    //
    var keys = Object.keys(remote_logs);

    function write_ops() {
      batch.call(db, ops, function(err) {
        if (err) db.emit('error', err);
      });
    }

    keys.forEach(function(log_key) {

      var remote_log = remote_logs[log_key];

      //
      // get the local log
      //
      db.get(log_key, function(err, local_log) {
        if (err && !err.notFound) return db.emit('error', err);

        //
        // we already have it and ours is the newest, bail out.
        //
        if (local_log && local_log.value.clock > remote_log.clock) return;

        //
        // we don't have it or ours is older, get it.
        //
        var remote_key = remote_logs[log_key].value.key;
        local_log = local_log || { clock: 0 };

        dbc.get(remote_key, function(err, remote_value) {
          if (err) return db.emit('error', err);

          console.log(remote_key, remote_value);


          // the remote key and value
          ops.push({ type: 'put', key: remote_key, value: remote_value });

          // construct a log
          var new_clock = Math.max(local_log.clock, remote_log.value.clock) + 1;
          remote_log.value.clock = new_clock;
          remote_log.type = 'put';

          ops.push(remote_log);

          write_ops(); // how many times this happens can be optimized
        });
      })
    });

  }

  function on_connect(conn, _port, _host) {

    var dbc = multilevel.client();
    conn.pipe(dbc.createRpcStream()).pipe(conn);
    db.emit('connect');

    getLastLog(function(err, last_log) {
      if (err) return db.emit('error', err);

      var logs = [];
      var error;

      //
      // get all the remote logs up until the last
      // locally known log and put them in local memory.
      //

      dbc.createReadStream({
        reverse: true,
        start: prefix + '~',
        end: last_log.key
      }).on('error', function(err) {
        error = err;
      }).on('data', function(d) {
        logs.push(d);
      }).on('end', function() {
        if (error) return db.emit('error', error);
        parse_logs(dbc, logs, _port, _host);
      });
    });
  }

  var loop;
  var connect_velocity;

  //
  // for testing we can use nice short intervals,
  // for real world use cases we want longer times.
  //
  // there needs to be a base number and the user should be able
  // to specify a multiplier that suits their use case. Otherwise
  // we can pick a pretty reasonable default.
  //
  var connection_multiplier = (options.multiplier || (test ? 10 : 1e6));

  function createLoop() {

    clearInterval(loop);

    loop = setInterval(function() {

      //
      // start the loop but don't connect if there is no activity?
      //
      if (!write_velocity) return;

      var l = Math.random() * servers.length;
      var r = Math.floor(l);
      var peer = servers[Math.floor(r)];

      if (peer) {
        peer = peer.split(':');
        var host = peer[0];
        var port = parseInt(peer[1], 10);
        var client = net.connect(port, host, function() {
          on_connect(client, port, host);
        });

        client.on('error', function(err) {
          db.emit('error');
        });
      }
    }, connect_velocity * connection_multiplier);
  };

  function getLastLog(cb) {

    var last_log;
    var error;

    db.createReadStream({
      reverse: true,
      limit: 1,
      start: prefix + '~'
    }).on('error', function(err) {
      error = err;
    }).on('data', function(r) {
      last_log = r;
    }).on('end', function() {
      if (error) return cb(error);
      else cb(null, last_log);
    });
  }

  function calcVelocity() {
    var reduction = (25 / 100) * connect_velocity;
    return connect_velocity - (write_velocity * reduction);
  }

  //
  // the connection velocity should be determined by the write velocity.
  // so we can poll for that value outside of the main connection loop.
  //
  var connector = setInterval(function() {
    //
    // don't increase the write velocity if no new writes have been made.
    // limit how long a loop can run for in the same state when there are
    // no new writes.
    //
    if (write_velocity <= last_write.velocity && write_velocity != 0) {

      //
      // should ticks be 1 for the test?
      //
      if (++last_write.ticks >= test ? 1 : (25 / 100 * write_velocity)) {
        last_write.ticks = 0;
        --write_velocity;
      }
    }

    //
    // this is a little arbitrary, but each write subtracts 25% of the
    // current connect_velocity. could/should this be more intellegent?
    //
    var new_velocity = calcVelocity();

    if (new_velocity < connect_velocity) {

      last_write.velocity = write_velocity;
      connect_velocity = new_velocity;
    }

    createLoop();
  }, 1e3);

  // get the next change for a key
  function getNextChange(type, key, cb) {

    var error;
    var last_change;

    db
      .createReadStream({
        reverse: true,
        limit: 1,
        start: prefix + key + '!~'
      }).on('error', function(err) {
        error = err;
      }).on('data', function(r) {
        if (r.key.indexOf(prefix) == -1) return;
        last_change = r.value;
        last_change.type = type;
        last_change.clock++;
      }).on('end', function() {
        if (last_change == null) {
          last_change = {
            type: type,
            key: key,
            clock: 1
          };
        }
        if (!error) cb(null, last_change);
        else cb(error);
      });
  }

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

    write_velocity += ops.length;
    last_write.velocity = write_velocity;

    var counter = ops.length;
    logs = [];

    ops.forEach(function(op) {
      getNextChange(op.type, op.key, function(err, change) {
        if (err) return cb(err);

        logs.push({
          type: 'put',
          key: prefix + [op.key, change.clock].join('!'),
          value: change
        });

        if (--counter == 0) {
          batch.call(db, ops.concat(logs), cb);
        }
      });
    })
  };

  db.close = function() {
    server.close();
    clearInterval(connector);
    close.apply(db, arguments);
  };

  return db;
}

