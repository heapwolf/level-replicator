var assert = require('assert');
var rimraf = require('rimraf');
var fs = require('fs');
var rep = require('..');
var mget = require('level-mget');
var uuid = require('node-uuid');

var dirpath = __dirname + '/db';

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

    var db1 = makeDB({ port: 9000, path: '/1', multiplier: 10, id: uuid.v4(), multicast: true });
    var db2 = makeDB({ port: 9001, path: '/2', multiplier: 10, id: uuid.v4(), multicast: true });
    var db3 = makeDB({ port: 9002, path: '/3', multiplier: 10, id: uuid.v4(), multicast: true });

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

        db1.close();
        db2.close();
        db3.close();
 
        done();
      }, 1000);

    }, 500);

  });



  it('arbitrary writes provided at different times' +
      'should propagate to all peers after N milliseconds', function(done) {

    var db1 = makeDB({ port: 9000, path: '/1', multiplier: 10, id: uuid.v4(), multicast: true });
    var db2 = makeDB({ port: 9001, path: '/2', multiplier: 10, id: uuid.v4(), multicast: true });
    var db3 = makeDB({ port: 9002, path: '/3', multiplier: 10, id: uuid.v4(), multicast: true });

    db1.on('error', function() { });
    db2.on('error', function() { });
    db3.on('error', function() { });

    var connect_count = { 9000: 0, 9001: 0, 9002: 0 };
    var connection_count = { 9000: 0, 9001: 0, 9002: 0 };

    var ops = 7;
    function assert_op(err) { 
      assert(!err); 
      if (--ops == 0) {
        db1.close();
        db2.close();
        db3.close();
        done(); 
      }
    }

    setTimeout(function() {

      db1.put('foo1', 100, assert_op);

      setTimeout(function() {
        db1.batch([
          { type: 'put', key: 'foo2', value: 200 },
          { type: 'put', key: 'foo3', value: 300 }
          ], assert_op);
      }, 800);

      db2.batch([
        { type: 'put', key: 'bar1', value: 100 },
        { type: 'put', key: 'bar2', value: 200 },
        { type: 'put', key: 'bar3', value: 300 }
        ], assert_op);

      db3.batch([
        { type: 'put', key: 'bazz1', value: 100 },
        { type: 'put', key: 'bazz2', value: 200 },
        { type: 'put', key: 'bazz3', value: 300 }
        ], assert_op);

      setTimeout(function() {

        var keys = ['foo1', 'foo2', 'foo3', 'bar1', 'bar2', 'bar3', 'bazz1', 'bazz2', 'bazz3'];

        mget(db1, keys, assert_op);
        mget(db2, keys, assert_op);
        mget(db2, keys, assert_op);

      }, 2000);

    }, 500);

  });

  it('desctructive operations should get propagated', function(done) {

    var db1 = makeDB({ port: 9000, path: '/1', multiplier: 10, id: uuid.v4(), multicast: true });
    var db2 = makeDB({ port: 9001, path: '/2', multiplier: 10, id: uuid.v4(), multicast: true });
    var db3 = makeDB({ port: 9002, path: '/3', multiplier: 10, id: uuid.v4(), multicast: true });

    db1.on('error', function() { });
    db2.on('error', function() { });
    db3.on('error', function() { });

    var connect_count = { 9000: 0, 9001: 0, 9002: 0 };
    var connection_count = { 9000: 0, 9001: 0, 9002: 0 };

    var ops = 7;

    function finish() {
      db1.close();
      db2.close();
      db3.close();
      done(); 
    }

    function assert_ok(err) { 
      assert(!err); 
      if (--ops == 0) finish();
    }

    function assert_fail(err) {
      assert(err);
      if (--ops == 0) finish();
    }

    setTimeout(function() {

      db1.put('foo', '0', assert_ok);
      db2.put('bar', '1', assert_ok);
      db3.put('bazz', '2', assert_ok);

      setTimeout(function() {
        db2.del('bar', assert_ok);
        
        setTimeout(function() {
          db1.get('bar', assert_fail);
          db2.get('bar', assert_fail);
          db2.get('bar', assert_fail);
        }, 1000);
      }, 500);
    }, 500);
  });

});

