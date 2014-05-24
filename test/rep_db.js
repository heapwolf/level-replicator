var mkdb = require('./misc').mkdb
var assert = require('assert')
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

  describe('server', function() {
    var repDB1 = mkdb('rep1')
    var db1 = mkdb('db1')
    var server1 = replicate.server(db1, repDB1, {port:8000, servers:{}})
    after(function() { server1.close() })

    it('works if versions match', function(done) {
      var server2 = replicate.server(mkdb(), mkdb(), {listen:'skip', servers:{'127.0.0.1:8000':{}}})
      server2.on('compatible', function(ver) {
        server2.emit('close')
        done()
      })
    })

    it('fails if versions do not match', function(done) {
      repDB1.put('version', '0.0.0', function(er) {
        if (er) throw er

        var server2 = replicate.server(mkdb(), mkdb(), {listen:'skip', servers:{'127.0.0.1:8000':{}}})
        server2.on('error', function(er) {
          assert.ok(er.message.match(/version/i), 'Error on version mismatch')
          server2.emit('close')
          done()
        })
      })
    })

    it('emits a "change" event', function(done) {
      db1.put('foo', 'bar')
      server1.on('change', function(change) {
        assert.equal(change.type , 'put')
        assert.equal(change.key  , 'foo')
        assert.equal(change.value, 'bar')
        done()
      })
    })
  })
})
