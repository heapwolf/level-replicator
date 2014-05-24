var path = require('path')
var net = require('net')
var EventEmitter = require('events').EventEmitter

var level = require('level')
var sublevel = require('level-sublevel')
var multilevel = require('multilevel')
var stringRange = require('string-range')
var hooks = require('level-hooks')
var mts = require('monotonic-timestamp')
var secure = require('secure-peer')

var replicate = require('./replicate')
var PACKAGE = require('./package.json')
var securepeer

function server(db, repDB, config) {
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

  ee.on('compatible', function(version) {
    server.emit('compatible', version)
  })

  hooks(db)

  if (repDB == 'sublevel') {
    // Use a sublevel for replication. This is more robust but requires other clients and code to be aware.
    db = sublevel(db)
    repDB = db.sublevel('_replicator')
    var not_my_key = anti_checker(repDB)
    db.hooks.pre(not_my_key, add_change)
  } else {
    // Use a separate database for replication. This works for any db and code, but can lead to data loss since the replication
    // log is not committed to disk in a transaction with the database changes. This could one day move to a journaling format,
    // with keys and values committed to the log first, then "confirmed" after the write succeeds. When starting up, replay
    // uncommitted journal entries in order.
    repDB = repDB || level(path.join(__dirname, 'replication-set'), { valueEncoding: 'json' })
    repDB = sublevel(repDB)
    db.hooks.post(log_change)
  }

  var changes = repDB.sublevel('changes', {valueEncoding:'json'})

  function log_change(change, add) {
    changes.put(mts(), {type:change.type, key:change.key}, function (er) {
      if (er)
        server.emit('error', er)
      else
        server.emit('change', change)
    })
  }

  function add_change(change, add) {
    add({type:'put', key:mts(), value:{type:change.type, key:change.key}, valueEncoding:'json'}, changes)
    setImmediate(function() { server.emit('change', change) })
  }

  changes.methods = db.methods || {}
  changes.methods['fetch'] = { type: 'async' }
  changes.methods['version'] = { type: 'async' }
  changes.methods['createReadStream'] = { type: 'readable' }

  changes.fetch = function(key, cb) {
    db.get(key, cb)
    ee.emit('fetch', key)
  }

  changes.version = function(cb) {
    repDB.get('version', function(er, version) {
      if (er)
        return ee.emit('error', er)
      cb(null, version)
    })
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

  var replicator = replicate(db, changes, ee, config)

  server.on('close', function() {
    clearInterval(replicator)
    db.close(function() {
      repDB.close(function() {
        server.emit('closed')
      })
    })
  })

  // Initialize the changes database structure.
  repDB.put('version', PACKAGE.version, function(er) {
    if(er)
      return ee.emit('error', er)

    if (config.listen == 'skip')
      server.emit('ready', changes)
    else
      server.listen(config.port || 8000, function() {
        ee.emit('listening', config.port || 8000)
        server.emit('ready', changes)
      })
  })

  return server
}


// Return a checker for all keys NOT within this sublevel.
function anti_checker(db) {
  var min = db.prefix()
  var max = min + db.options.sep + db.options.sep // This may be slighly wrong but as long as keys do not start with \xff it's ok.
  var checker = stringRange.checker({'min':min, 'max':max})

  return function not_in_range(key) {
    return ! checker(key)
  }
}


exports.createServer = server 
exports.server = server
exports.install = server
