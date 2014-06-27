
/*
 *
 * peers.js
 * responsible for multicating the existence of this server
 * and keeping track of other servers that have been found.
 *
 */

var dgram = require('dgram');

module.exports = function(options) {

  var peerDiscoveryInterval = options.peerDiscoveryInterval || 1e3;
  var broadcastAddress = options.broadcastAddress || '224.0.0.1';
  var broadcastPort = options.broadcastPort || 4001;
  var peer = dgram.createSocket('udp4');
  var address = new Buffer([options.host, options.port].join(':'));

  peer.bind(broadcastPort, function() {
    peer.addMembership(broadcastAddress);
  });

  peer.on('message', function (data, info) {
    var address = String(data);
    var myaddress = [options.host, options.port].join(':');
    if (address != myaddress) {
      options.peers[address] = Date.now();
    }
  });

  peerFinder = setInterval(function() {
    peer.send(
      address,
      0,
      address.length,
      broadcastPort,
      broadcastAddress);
  }, peerDiscoveryInterval);
};

