var net = require('net')
var multilevel = require('multilevel')

module.exports = function(localdb, rs, ee, config) {

  var connections = config.connections || {}

  connections.interval = connections.interval || 500
  connections.tmax = connections.tmax || 500

  var remotedb = multilevel.client({
    "methods": {
      "fetch": { "type": "async" }
    }
  })

  function connect(host, port) {

    var stream = net.connect(port, host, function() {
      ee.emit('connect', config.servers[[host, port].join(':')])
    })

    stream.on('error', function(err) {
      ee.emit('error', err)
      stream.end()
    })

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

      remotedb
        .createReadStream(opts)
        .on('data', function(r) {
          if (r.type == 'put') {
            remotedb.fetch(r.key, function(err, val) {
              if (!err) {
                localdb.put(r.key, val, function(err) {
                })
              }
            })
          }
          else if (r.type == 'del') {
            localdb.del(r.key)
          }
        })
    }

    var lastRecord

    rs.createReadStream({
      reverse: true,
      values: false,
      limit: 1
    }).on('data', function (r) {
      lastRecord = r
    }).on('end', function() {
      pull(lastRecord)
    })
  }

  function randomServer() {
    var servers = Object.keys(config.servers)
    var r = Math.random()*servers.length
    return servers[Math.floor(r)]
  }

  setInterval(function() {

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
}

