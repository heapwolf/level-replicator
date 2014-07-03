/*
 *
 * connect.js
 * responsible for handling outbound connections
 *
 */
var net = require('net');

module.exports = function(db, options, writes, cb) {

  var multiplier = options.multiplier || 1e6;
  var connect_velocity = 100 // multiplier * 100;
  var intervals = { chrono: null, loop: null };

  function connect() {
    clearInterval(intervals.chrono);
    intervals.chrono = setInterval(function() {

      var serverkeys = Object.keys(options.peers);
      var l = Math.random() * serverkeys.length;
      var r = Math.floor(l);
      var peer = serverkeys[Math.floor(r)];

      if (peer) {
        peer = peer.split(':');
        var host = peer[0];
        var port = parseInt(peer[1], 10);
        var client = net.connect(port, host, function() {
          cb(client, host, port);
        });

        client.on('error', function(err) {
          db.emit('error');
        });
      }
    }, connect_velocity);
  }

  //
  // the connection velocity should be determined by the write velocity.
  // so we can poll for that value outside of the chronometer.
  //
  intervals.loop = setInterval(function() {

    //
    // force the loop to decay over time.
    //
    if (writes.velocity <= writes.last_velocity && writes.velocity >= 0) {
      writes.ticks++;

      if (writes.ticks >= writes.velocity * 2) {
        writes.ticks = 0;
        --writes.velocity;
      }
    }

    var new_interval = 0 // writes.velocity * multiplier;

    if (new_interval != writes.last_velocity) {
      writes.last_velocity = writes.velocity;
      connect_velocity = new_interval;
      connect();
    }

  }, 1e3);

  connect()

  //
  // return the intervals that we use so that when the
  // database is closed the intervals can be cleared.
  //
  return intervals;
};

