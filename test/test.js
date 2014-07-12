var assert = require('assert');
var rimraf = require('rimraf');
var fs = require('fs');
var rep = require('..');
var mget = require('level-mget');
var uuid = require('node-uuid');
var level = require('level');
var mts = require('monotonic-timestamp');

var dirpath = __dirname + '/db';

function makeDB(config) {
  config = config || {}
  var db = level(dirpath + (config.path || '/1'), { valueEncoding: 'json' });
  return rep(db, config);
}

describe('Replicator', function () {

  beforeEach(function(done) {
    rimraf(dirpath, function() {
      fs.mkdir(dirpath, done);
    });
  });

  it('peers should connect to eachother when there are writes', function(done) {

    var n1 = uuid.v4();
    var n2 = uuid.v4();
    var n3 = uuid.v4();

    var db1 = makeDB({ port: 9000, path: '/' + n1, multiplier: 10, id: n1, multicast: true });
    var db2 = makeDB({ port: 9001, path: '/' + n2, multiplier: 10, id: n2, multicast: true });
    var db3 = makeDB({ port: 9002, path: '/' + n3, multiplier: 10, id: n3, multicast: true });

    console.log('creating three databases');

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

    console.log('waiting for them to connect');

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

        console.log('the databases connected to eachother');

        db1.close();
        db2.close();
        db3.close();
 
        done();
      }, 1000);

    }, 1000);

  });

  it('arbitrary writes provided at different times' +

      'should propagate to all peers after N milliseconds', function(done) {

    var db1 = makeDB({ port: 9000, path: '/A', multiplier: 10, id: 'A', multicast: true });
    var db2 = makeDB({ port: 9001, path: '/B', multiplier: 10, id: 'B', multicast: true });
    var db3 = makeDB({ port: 9002, path: '/C', multiplier: 10, id: 'C', multicast: true });

    db1.on('error', function() { });
    db2.on('error', function() { });
    db3.on('error', function() { });

    var connect_count = { 9000: 0, 9001: 0, 9002: 0 };
    var connection_count = { 9000: 0, 9001: 0, 9002: 0 };

    var ops = 3;

    function assert_op(err) { 
      if (err) console.log(err)
      assert(!err); 
      if (--ops == 0) {
        setTimeout(validate, 1000);
      }
    }

    function validate() {
 
      var keys = ['foo1', 'foo2', 'foo3', 'bar1', 'bar2', 'bar3', 'bazz1', 'bazz2', 'bazz3'];

      mget(db1, keys, function(err, value) { assert(!err); assert(Object.keys(value).length == keys.length)
      mget(db2, keys, function(err, value) { assert(!err); assert(Object.keys(value).length == keys.length)
      mget(db2, keys, function(err, value) { assert(!err); assert(Object.keys(value).length == keys.length)

        console.log('each database has %d keys', keys.length);

        db1.close();
        db2.close();
        db3.close();
        done();

      }) }) });
    }

    setTimeout(function() {

      console.log('writing 3 keys to each database');

      db1.batch([
        { type: 'put', key: 'foo1', value: 100 },
        { type: 'put', key: 'foo2', value: 200 },
        { type: 'put', key: 'foo3', value: 300 }
        ], assert_op);

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

    }, 500);

  });


  it('xarbitrary writes provided at different times' +
      'should propagate to all peers after N milliseconds', function(done) {

    var db1 = makeDB({ port: 9000, path: '/A', multiplier: 10, id: 'A', multicast: true });
    var db2 = makeDB({ port: 9001, path: '/B', multiplier: 10, id: 'B', multicast: true });
    var db3 = makeDB({ port: 9002, path: '/C', multiplier: 10, id: 'C', multicast: true });

    db1.on('error', function() { });
    db2.on('error', function() { });
    db3.on('error', function() { });

    var connect_count = { 9000: 0, 9001: 0, 9002: 0 };
    var connection_count = { 9000: 0, 9001: 0, 9002: 0 };

    var ops = 3;

    function assert_op(err) { 
      assert(!err); 
      if (--ops == 0) {
        setTimeout(validate, 1000);
      }
    }

    function validate() {
 
      var keys = ['foo1', 'foo2', 'foo3', 'bar1', 'bar2', 'bar3', 'bazz1', 'bazz2', 'bazz3'];

      mget(db1, keys, function(err, value) { assert(!err); assert(Object.keys(value).length == keys.length)
      mget(db2, keys, function(err, value) { assert(!err); assert(Object.keys(value).length == keys.length)
      mget(db2, keys, function(err, value) { assert(!err); assert(Object.keys(value).length == keys.length)

        console.log('\neach database has %d keys', keys.length);

        db2.del('foo2', function() {

          console.log('deleted `foo2` from `db2`');

          setTimeout(function() {

            db1.get('foo2', function(err) {
              assert(err);
              db2.get('foo2', function(err) {
                assert(err);
                db3.get('foo2', function(err) {
                  assert(err);

                  console.log('`foo2` was not found in any database.');

                  db1.close();
                  db2.close();
                  db3.close();
                  done();
                });
              });
            });

          }, 2000);
        });

      }) }) });
    }

    setTimeout(function() {

      console.log('\nwriting 3 keys to each database');

      db1.batch([
        { type: 'put', key: 'foo1', value: 100 },
        { type: 'put', key: 'foo2', value: 200 },
        { type: 'put', key: 'foo3', value: 300 }
        ], assert_op);

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

    }, 500);

  });



/*  it('resolve a conflict', function(done) {

    var n1 = uuid.v4();
    var n2 = uuid.v4();
    var n3 = uuid.v4();

    var resolver = function(a, b) {
      if (a.timestamp < b.timestamp) return true;
    };

    var db1 = makeDB({ port: 9000, path: '/' + n1, multiplier: 10, id: n1, multicast: true, resolver: resolver });
    var db2 = makeDB({ port: 9001, path: '/' + n2, multiplier: 10, id: n2, multicast: true, resolver: resolver });
    var db3 = makeDB({ port: 9002, path: '/' + n3, multiplier: 10, id: n3, multicast: true, resolver: resolver });

    db1.on('error', function() {});
    db2.on('error', function() {});
    db3.on('error', function() {});

    setTimeout(function() {

      db1.put('foo', { value: '100', timestamp: mts() }, function(err) { assert(!err); })
      db2.put('foo', { value: '200', timestamp: mts() }, function(err) { assert(!err); })
      db3.put('foo', { value: '300', timestamp: mts() }, function(err) { assert(!err); })

      setTimeout(function() {

        db1.get('foo', function(err, val) {
          console.log('[db1]', val);
          db2.get('foo', function(err, val) {
            console.log('[db2]', val);
            db3.get('foo', function(err, val) {
              console.log('[db3]', val);
              done();
            });
          });
        });

      }, 1000);

    }, 1000);
  });*/
});

