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
})

// Utility function for debugging
function dir(db) {
  db.createReadStream().on('data', function(D) {
    console.log(D)
  })
}
