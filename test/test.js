var assert = require('assert');
var rimraf = require('rimraf');
var rep = require('..');

var dirpath = __dirname + '/db';
var default_prefix = '\xff__changes__\xff';
var db = require('level')(dirpath, { valueEncoding: 'json' });

db = rep.server(db);

describe('Replicator', function () {

  beforeEach(function(done) {
    rimraf(dirpath, done);
  });

  it('on each destructive operation, a logical clock should be incremented and the operation type recorded for each corresponding key', function(done) {

    function verifyLogs() {
      var count = 4;
      db.get(default_prefix + 'normal_put!1', function(err, value) {
        assert(value.clock == 1);
        assert(value.type == 'put');
        if (--count == 0) done();
      });

      db.get(default_prefix + 'normal_put!2', function(err, value) {
        assert(value.clock == 2);
        assert(value.type == 'del');
        if (--count == 0) done();
      });

      db.get(default_prefix + 'batched_put!1', function(err, value) {
        assert(value.clock == 1);
        assert(value.type == 'put');
        if (--count == 0) done();
      });

      db.get(default_prefix + 'batched_put!2', function(err, value) {
        assert(value.clock == 2);
        assert(value.type == 'del');
        if (--count == 0) done();
      });
    
    }

    db.put('normal_put', 1, function(err) {
      assert(!err);

      db.batch([
        { type: 'put', key: 'batched_put', value: 1 },
        { type: 'del', key: 'normal_put' }
      ], function(err) {
        if (err) console.log(err);

        db.del('batched_put', function(err) {
          if (err) console.log(err);
          verifyLogs()
        });
      });
    })

  });
});
