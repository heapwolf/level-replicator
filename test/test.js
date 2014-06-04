var assert = require('assert');
var rimraf = require('rimraf');
var rep = require('..');

var dirpath = __dirname + '/db';
var default_prefix = '\xff__changes__\xff';

function makeDB(config) {
  config = config || {}
  var db = require('level')(config.path || dirpath, { valueEncoding: 'json' });
  return rep.server(db, config);
}

describe('Replicator', function () {

  beforeEach(function(done) {
    rimraf(dirpath, done);
  });

  it('on each destructive operation, a logical clock should be incremented and the operation type recorded for each corresponding key', function(done) {

    var db = makeDB();

    assert(db, 'an instance can be created and run with no peers to connect to');

    function finish() {
      db.close();
      assert(db.isClosed(), 'database can be closed properly');
      done();
    }

    function verifyLogs() {
      var count = 4;
      db.get(default_prefix + 'normal_put!1', function(err, value) {
        assert(value.clock == 1, 'log entry was created');
        assert(value.type == 'put', 'the type of operation was recorded');
        if (--count == 0) finish();
      });

      db.get(default_prefix + 'normal_put!2', function(err, value) {
        assert(value.clock == 2, 'log entry created and clock incremented');
        assert(value.type == 'del', 'type changed to reflect last operation');
        if (--count == 0) finish();
      });

      db.get(default_prefix + 'batched_put!1', function(err, value) {
        assert(value.clock == 1, 'log entry was created');
        assert(value.type == 'put', 'the type of operation was recorded');
        if (--count == 0) finish();
      });

      db.get(default_prefix + 'batched_put!2', function(err, value) {
        assert(value.clock == 2, 'log entry created and clock incremented');
        assert(value.type == 'del', 'type changed to reflect last operation');
        if (--count == 0) finish();
      });
    
    }

    db.put('normal_put', 1, function(err) {
      assert(!err, 'successful put');

      db.batch([
        { type: 'put', key: 'batched_put', value: 1 },
        { type: 'del', key: 'normal_put' }
      ], function(err) {
        assert(!err, 'successful batch');

        db.del('batched_put', function(err) {
          assert(!err, 'successful delete');
          verifyLogs();
        });
      });
    })

  });

  //
  // within a 1000ms window there should be no connect events if there are no write operations.
  // after a few write operations, the peer should start to try to connect.
  // after doing nothing for 1000ms, the number of connects should decrease.
  //
  //
  // this test asserts that the following things work together...
  //
  // 1. the databases are able to accept connections.
  // 2. the databases are able to connect to other databases.
  // 3. the databases connect to eachother based on their write velocity.
  // 4. the number of connection attempts should slow down if writes slow down.
  //
  it('the connection velocity should be determined by the write velocity', function(done) {

    var db1 = makeDB({ servers: ['127.0.0.1:9001'], port: 9000, path: __dirname + '/db1', test: true });
    var db2 = makeDB({ servers: ['127.0.0.1:9000'], port: 9001, path: __dirname + '/db2', test: true });

    db1.on('error', function() { /* we can swallow connect errors for this test. */ });
    db2.on('error', function() { /* we can swallow connect errors for this test. */ });

    var connect_count = 0;
    var connection_count = 0;

    db1.on('connect', function() {
      connect_count++;
    });

    db2.on('connection', function() {
      connection_count++;
    });

    function finish() {
      assert(connection_count == 0, 'the server should have stopped getting connections');
      db1.close();
      db2.close();
      done();
    }

    db1.on('listening', function() {
      assert(true, 'database should be able to listen for connections');

      setTimeout(function() {
        assert(connect_count == 0, 'no data has been written, no connections should have been made');

          db1.put('test_key', 1, function(err) {
            assert(!err, 'a test key was put into the database');

            setTimeout(function() {

              assert(connection_count > 0, 'the server should have received at least one connection');
              assert(connect_count > 0, 'after writes, the server should start connecting');
              connection_count = 0;

              setTimeout(function() {
                finish();
              }, 1e3);
            }, 1e3);
        });
      }, 2e3);
    });
  });

});

