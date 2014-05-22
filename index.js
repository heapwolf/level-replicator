var path = require('path')
var net = require('net')
var EventEmitter = require('events').EventEmitter

var level = require('level')
var multilevel = require('multilevel')
var hooks = require('level-hooks')
var mts = require('monotonic-timestamp')
var secure = require('secure-peer')

var replicate = require('./replicate')
var securepeer

function server(db, changes, config) {

  config = config || {}
  config.sep = config.sep || db.sep || '\xff'

  if (config.pems) {
    var pems = require(config.pems)
    config.public = pems.public
    securepeer = secure(pems)
  }

  var opts = {
    valueEncoding: 'json'
  }

  var ee = new EventEmitter

  ee.on('error', function(err) {
    server.emit('error', err)
  })

  changes = changes || level(
    path.join(__dirname, 'replication-set'), 
    { valueEncoding: 'json' }
  )

  hooks(db)

  db.hooks.post(function (change, add) {
    changes.put(mts(), { type: change.type, key: change.key })
  })

  changes.methods = db.methods || {}
  changes.methods['fetch'] = { type: 'async' }
  changes.methods['createReadStream'] = { type: 'readable' }

  changes.fetch = function(key, cb) {
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

    if (securepeer && config.pems) {

      var securedpeer = securepeer(function (stream) {
        stream.pipe(multilevel.server(changes, config)).pipe(stream)
      })
      securedpeer.pipe(con).pipe(securedpeer)

      if (!config.identify) {
        throw new Error('A secure connection requres that an identify method be defined.')
      }

      securedpeer.on('identify', config.identify.bind(config));
    }
    else {
      con.pipe(multilevel.server(changes, config)).pipe(con)
    }

  })

  if (! config.no_server)
    server.listen(config.port || 8000, function() {
      ee.emit('listening', config.port || 8000)
    })

  var replicator = replicate(db, changes, ee, config)

  server.on('close', function() {
    clearInterval(replicator)
    db.close(function() {
      changes.close(function() {
        server.emit('closed')
      })
    })
  })

  return server
}

exports.createServer = server 
exports.server = server
exports.install = server
