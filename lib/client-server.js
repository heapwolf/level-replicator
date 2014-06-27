/*
 *
 * client-server.js
 * responsible for creating a client and server that
 * provide a protocol on which to replicate.
 *
 */

var net = require('net');
var multilevel = require('multilevel');

exports.createServer = function(db, options) {
  var server = net.createServer(function (con) {
    con.pipe(multilevel.server(db, options)).pipe(con);
  });

  server.listen(options.port, function() {
    db.emit('listening');
  });

  server.on('connection', function() {
    db.emit('connection', options.host, options.port);
  });

  server.on('error', function (err) {
    db.emit('error', err);
  });

  return server;
};

exports.createClient = function(conn) {
  var dbc = multilevel.client({
    "methods": {
      "addPeer": { "type": "async" },
      "identifyPeer": { "type": "async" }
    }
  });

  conn.pipe(dbc.createRpcStream()).pipe(conn);
  return dbc;
};

