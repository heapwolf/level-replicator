var assert = require('assert')
var levelup = require('levelup')
var memdown = require('memdown')
var replicate = require('../')

describe('Replicator', function () {
  var db, repDB
  beforeEach(function(done) {
    db = mkdb('db')
    repDB = mkdb('rep')
    done()
  })

  describe('DB', function() {
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
      var server = replicate.install(db, repDB, {listen:'skip'})
      server.on('ready', function(changesDB) {
        assert.ok(changesDB, 'Changes DB is passed through the callback')
        done()
      })
    })

    it('sets its version', function(done) {
      var server = replicate.install(db, repDB, {listen:'skip'})
      server.on('ready', function(changesDB) {
        repDB.get('version', function(er, res) {
          if (er) throw er
          assert.equal(res, require('../package.json').version, 'Package version is in the changes DB')
          done()
        })
      })
    })
  }) // DB
})

function mkdb(name) {
  name = name || 'db'
  var db = levelup(name, {db:memdown})
  assert.ok(db, 'Make a db: ' + name)
  return db
}
