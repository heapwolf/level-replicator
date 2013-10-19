var path = require('path')
var net = require('net')
var EventEmitter = require('events').EventEmitter

var level = require('level')
var multilevel = require('multilevel')
var hooks = require('level-hooks')
var mts = require('monotonic-timestamp')

var replicate = require('./replicate')

function server(db, rs, config) {

  config = config || {}
  config.sep = config.sep || db.sep || '\xff'

  var opts = {
    valueEncoding: 'json'
  }

  var ee = new EventEmitter

  rs = rs || level(
    path.join(__dirname, 'replication-set'), 
    { valueEncoding: 'json' }
  )

  hooks(db)

  db.hooks.post(function (change, add) {
    var key = change.key + config.sep + mts()
    rs.put(key, change)
  })

  rs.methods = db.methods || {}
  rs.methods['fetch'] = { type: 'async' }

  rs.fetch = function(key, cb) {
    db.get(key, cb)
    ee.emit('fetch', key)
  }

  config.access = config.access || function() {
    return true
  }

  config.auth = config.auth || function(user, cb) {
    cb(null, user)
  }

  var server = net.createServer(function (con) {
    ee.emit('connection')
    con.pipe(multilevel.server(rs, config)).pipe(con)
  }).listen(config.port || 8000, function() {
    ee.emit('listening', config.port || 8000)
  })
  replicate(db, rs, ee, config)
  return server
}

exports.createServer = server 
exports.server = server
exports.install = server

