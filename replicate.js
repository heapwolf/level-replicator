var net = require('net')
var multilevel = require('multilevel')
var secure = require('secure-peer')

var securepeer

module.exports = function(localdb, changes, ee, config) {

  var connections = config.connections || {}

  connections.interval = connections.interval || 500
  connections.tmax = connections.tmax || 500

  var remotedb = multilevel.client({
    "methods": {
      "createReadStream": { "type": "readable" },
      "fetch": { "type": "async" }
    }
  })

  if (config.pems) {
    var pems = require(config.pems)
    config.public = pems.public
    securepeer = secure(pems)
  }

  function connect(host, port) {

    var rawStream = net.connect(port, host, function() {
      ee.emit('connect')
    })

    rawStream.on('error', function(err) {
      ee.emit('error', err)
      rawStream.end()
    })

    if (securepeer && config.pems) {
      var sec = securepeer(function (stream) {
        replicate(stream)
      })

      sec.pipe(rawStream).pipe(sec)

      sec.on('identify', function(id) {
        id.accept()
      })
    }
    else {
      replicate(rawStream)
    }

    function replicate(stream) {

      stream.pipe(remotedb.createRpcStream()).pipe(stream)

      if (connections.tmax) {
        setTimeout(function() {
          ee.emit('timeout')
          stream.end()
        }, connections.tmax)
      }

      function pull(lastRecord) {

        var opts = {
          reverse: true,
          keys: false
        }

        if (lastRecord) {
          opts.end = lastRecord + '~'
        }

        var uniques = {}
        var ops = []
        var waiting = 0
        var wait

        remotedb
          .createReadStream(opts)
          .on('data', function(r) {
            if (!uniques[r.key]) {
              if (r.type == 'put') {
                waiting++
                remotedb.fetch(r.key, function(err, val) {
                  if (err) return ee.emit('error', err)
                  ops.push({ type: 'put', key: r.key, value: val })
                  waiting--
                })
              }
              else if (r.type == 'del') {
                ops.push({ type: 'del', key: r.key })
              }
            }
          })
          .on('end', function() {
            if (waiting > 0) {
              wait = setInterval(function() {
                if (waiting == 0) {
                  clearInterval(wait)
                  localdb.batch(ops, function(err) {
                    if (err) return ee.emit('error', err)
                    ops.length = 0
                  })
                }
              }, 64)
            }
          })
      }

      var lastRecord

      changes.createReadStream({
        reverse: true,
        values: false,
        limit: 1
      })
      .on('error', function(err) {
        ee.emit('error', err)
      })
      .on('data', function (r) {
        lastRecord = r
      })
      .on('end', function() {
        pull(lastRecord)
      })
    }
  }

  function randomServer() {
    var servers = Object.keys(config.servers || {})
    var r = Math.random()*servers.length
    return servers[Math.floor(r)]
  }

  var interval = setInterval(function() {

    var server

    if (config.getServer) {
      server = getServer()
    }
    else {
      server = randomServer()
    }

    if (server) {
      server = server.split(':')
      var host = server[0]
      var port = parseInt(server[1], 10)
      connect(host, port)
    }
  }, connections.interval)

  return interval
}

