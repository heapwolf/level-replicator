var assert = require('assert')
var levelup = require('levelup')
var memdown = require('memdown')
var replicate = require('../')

var db, repDB
before(function(done) {
  db = levelup('db', {db:memdown})     ; assert.ok(db, 'Make a data DB')  ;
  repDB = levelup('rep', {db:memdown}) ; assert.ok(repDB, 'Make a replication DB')
  done()
})

describe('Replicator DB', function () {
  it('starts out empty', function(done) {
    var keys = 0
    repDB.createKeyStream()
    .on('data', function(D) { keys++ })
    .on('end', function() {
      assert.equal(keys, 0, 'No keys in the replication DB')
      done()
    })
  })

  it('initializes with a callback', function(done) {
    replicate.install(db, repDB, {listen:'skip'}, function(er, server, changes) {
      assert.ok(!er, 'No problem initializing replication')
      assert.ok(changes, 'Changes DB is passed through the callback')
      done()
    })
  })

  it('sets its version', function(done) {
    repDB.get('version', function(er, res) {
      if (er) throw er
      assert.equal(res, require('../package.json').version, 'Package version is in the changes DB')
      done()
    })
  })
})
