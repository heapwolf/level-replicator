var assert = require('assert');
var rimraf = require('rimraf');
var fs = require('fs');
var rep = require('..');
var uuid = require('node-uuid');

var dirpath = __dirname + '/db';
var default_prefix = '\xff__changes__\xff';

function makeDB(config) {
  config = config || {}
  var db = require('level')(dirpath + (config.path || '/1'), { valueEncoding: 'json' });
  return rep(db, config);
}

describe('Replicator', function () {

  beforeEach(function(done) {
    rimraf(dirpath, function() {
      fs.mkdir(dirpath, done);
    });
  });

  it('peers should connect to eachother when there are writes', function(done) {

    var db1 = makeDB({ port: 9000, path: '/1', multiplier: 10, id: uuid.v4() });
    var db2 = makeDB({ port: 9001, path: '/2', multiplier: 10, id: uuid.v4() });
    var db3 = makeDB({ port: 9002, path: '/3', multiplier: 10, id: uuid.v4() });

    db1.on('error', function() { });
    db2.on('error', function() { });
    db3.on('error', function() { });

    var connect_count = { 9000: 0, 9001: 0, 9002: 0 };
    var connection_count = { 9000: 0, 9001: 0, 9002: 0 };

    var on_connect = function(host, port) {
      connect_count[port]++;
    };

    var on_connection = function(host, port) {
      connection_count[port]++;
    };

    db1.on('connect', on_connect);
    db2.on('connect', on_connect);
    db3.on('connect', on_connect);

    db1.on('connection', on_connection);
    db2.on('connection', on_connection);
    db3.on('connection', on_connection);

    function fin(err) { assert(!err); }

    setTimeout(function() {

      db1.put('foo1', 100, fin);

      setTimeout(function() {
        db1.batch([
          { type: 'put', key: 'foo2', value: 200 },
          { type: 'put', key: 'foo3', value: 300 }
          ], fin);
      }, 800);

      db2.batch([
        { type: 'put', key: 'bar1', value: 100 },
        { type: 'put', key: 'bar2', value: 200 },
        { type: 'put', key: 'bar3', value: 300 }
        ], fin);

      db3.batch([
        { type: 'put', key: 'bazz1', value: 100 },
        { type: 'put', key: 'bazz2', value: 200 },
        { type: 'put', key: 'bazz3', value: 300 }
        ], fin);

      setTimeout(function() {

        assert(connect_count['9000'] > 2, 'db1 connected more than once');
        assert(connect_count['9001'] > 2, 'db2 connected more than once');
        assert(connect_count['9002'] > 2, 'db3 connected more than once');
        assert(connection_count['9000'] > 2, 'db1 was connected to more than once');
        assert(connection_count['9001'] > 2, 'db2 was connected to more than once');
        assert(connection_count['9002'] > 2, 'db3 was connected to more than once');
        done();
      }, 2000);

    }, 500);

  });
});

