var mkdb = require('./misc').mkdb
var assert = require('assert')
var replicate = require('../')


describe('Replicator sublevel', function () {
  it('allows a "sublevel" parameter', function(done) {
    var srv = replicate.install(mkdb(), 'sublevel', {listen:'skip'})
    srv.on('ready', function() {
      done()
    })
  })
})
