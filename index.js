var net = require('net')

var multilevel = require('multilevel');

var prefix = '\xff__changes__\xff';
exports.server = function server(db) {

  if (db.sep) { // prefer sublevel's delimiter
    prefix = db.sep + '__changes__' + db.sep;
  }

  var put = db.put;
  var batch = db.batch;
  var del = db.del;

  // get the next change for a key
  function getNextChange(type, key, cb) {
    var error;
    var last_change;
    var s = db.createReadStream({
      reverse: true,
      limit: 1,
      start: prefix + key + '!~'
    })
    s.on('error', function(err) {
      error = err;
    })
    s.on('data', function(r) {
      if (r.key.indexOf(prefix) == -1) return;
      last_change = r.value;
      last_change.type = type;
      last_change.clock++;
    })
    s.on('end', function() {
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

  function prepOp(type, key, value, options) {
    var new_value = { type: type, key: key, value: value };
    if (options.keyEncoding) new_value.keyEncoding = options.keyEncoding;
    if (options.valueEncoding) new_value.valueEncoding = options.valueEncoding;
    return new_value;
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

    var op = prepOp('put', key, value, options);
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

    var that = this;
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

