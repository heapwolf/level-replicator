var net = require('net')
var multilevel = require('multilevel');

var prefix = '\xff__changes__\xff';
exports.server = function server(db, options) {

  if (db.sep) { // prefer sublevel's delimiter
    prefix = db.sep + '__changes__' + db.sep;
  }

  var put = db.put;
  var batch = db.batch;
  var del = db.del;

  var write_velocity = 0;
  var connect_interval = 18e5; // 1.5HR
  var connection = 0;

  var server = net.createServer(function (con) {
    con.pipe(multilevel.server(db, options)).pipe(con);
  });

  function on_connect(s) {
    stream.pipe(db.createRpcStream()).pipe(stream);
    
    //
    // determine what to pull down here.
    //
  }

  var loop;
  var connect_velocity;

  function createLoop() {

    clearInterval(loop);
    loop = setInterval(function() {

      var servers = Object.keys(config.servers || {})
      var r = Math.random()*servers.length
      var peer = servers[Math.floor(r)]
   
      if (peer) {
        peer = server.split(':');
        var host = peer[0];
        var port = parseInt(peer[1], 10);
        net.connect(port, host, on_connect)
      }
    }, connect_velocity);
  };

  //
  // the connection velocity should be determined by the write velocity.
  // so we can poll for that value outside of the main connection loop.
  //
  var connection_selector = setInterval(function() {
    var new_velocity = connect_interval - (write_velocity * 1e3);
    if (connect_velocity > new_velocity) {
      connect_velocity = new_velocity;
      createLoop();
    }
  }, 1e4);


  // get the next change for a key
  function getNextChange(type, key, cb) {

    var error;
    var last_change;

    db
      .createReadStream({
        reverse: true,
        limit: 1,
        start: prefix + key + '!~'
      })
      .on('error', function(err) {
        error = err;
      })
      .on('data', function(r) {
        if (r.key.indexOf(prefix) == -1) return;
        last_change = r.value;
        last_change.type = type;
        last_change.clock++;
      })
      .on('end', function() {
        if (last_change == null) {
          last_change = {
            type: type,
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

  return db;
}

