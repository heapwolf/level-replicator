var level = require('level')
var fs = require('fs')
var r = require('../index')
var rmrf = require('rimraf')
var crypto = require('crypto')
var ASSERT = require('assert').ok

//
// generate some certs
//
var selfsigned = require('selfsigned')
var pems
var datadir = __dirname + '/data'
var pemsdir = __dirname + '/pems'

console.log('Generating pems for testing secure peers...')
fs.mkdirSync(pemsdir)

pems = selfsigned.generate({ subj: '/CN=contoso.com', days: 365 })
fs.writeFileSync(pemsdir + '/pems.json', JSON.stringify(pems))

pems = selfsigned.generate({ subj: '/CN=contoso.com', days: 365 })
fs.writeFileSync(pemsdir + '/pems-alt.json', JSON.stringify(pems))

var noop = function() {}

var configDB = {
  valueEncoding: 'json'
}

var config1 = {
  servers: {
    "127.0.0.1:8001": {},
    "127.0.0.1:8002": {}
  },
  port: 8000,
  connections: {
    interval: 300
  }
}

var config2 = {
  servers: {
    "127.0.0.1:8000": {},
    "127.0.0.1:8002": {}
  },
  port: 8001,
  connections: {
    interval: 300
  }
}

var config3 = {
  servers: { 
    "127.0.0.1:8000": {},
    "127.0.0.1:8001": {}
  },
  port: 8002,
  connections: {
    interval: 300
  }
}

describe('sanity tests', function () {

  it('add data to db0 and expect it exists on db1 and db2 after t seconds', function (done) {

    fs.mkdirSync(datadir)

    var db = [
      level(datadir + '/db0', configDB), 
      level(datadir + '/db1', configDB),
      level(datadir + '/db2', configDB)
    ]

    var rs = [
      level(datadir + '/rs0', configDB),
      level(datadir + '/rs1', configDB),
      level(datadir + '/rs2', configDB)
    ]

    var r1 = r.server(db[0], rs[0], config1)
    var r2 = r.server(db[1], rs[1], config2)
    var r3 = r.server(db[2], rs[2], config3)

    r1.on('error', noop)
    r2.on('error', noop)
    r3.on('error', noop)

    r1.on('closed', close)
    r2.on('closed', close)
    r3.on('closed', close)

    var counter = 0
    
    function close(t) {
      if (++counter == 2) {
        rmrf(datadir, function() {
          setTimeout(function() {
            done()
          }, 500)
        })
      }
    }

    db[0].put('testkey', 'testvalue', function(err) {
      ASSERT(!err, 'key put into database db0')

      setTimeout(after1, 1000)

      function after1() {

        db[1].get('testkey', function(err, value) {
          ASSERT(value, 'key found in database db1')

          setTimeout(after2, 500)
        })
      }

      function after2() {

        db[2].get('testkey', function(err, value) {
          ASSERT(value, 'key found in database db2')
          r1.close()
          r2.close()
          r3.close()
        })
      }
    })
  })

  it('replicate between multiple servers (secure peers)', function (done) {

    fs.mkdirSync(datadir)

    var db = [
      level(datadir + '/db0', configDB), 
      level(datadir + '/db1', configDB),
      level(datadir + '/db2', configDB)
    ]

    var rs = [
      level(datadir + '/rs0', configDB),
      level(datadir + '/rs1', configDB),
      level(datadir + '/rs2', configDB)
    ]

    config1.pems = config2.pems = config3.pems = pemsdir + '/pems.json'
    config1.identify = config2.identify = config3.identify = function (id) {
      this.public == id.key.public ? id.accept() : id.reject()
    }

    var r1 = r.server(db[0], rs[0], config1)
    var r2 = r.server(db[1], rs[1], config2)
    var r3 = r.server(db[2], rs[2], config3)

    r1.on('error', noop)
    r2.on('error', noop)
    r3.on('error', noop)

    r1.on('closed', close)
    r2.on('closed', close)
    r3.on('closed', close)

    r1.on('closed', close)
    r2.on('closed', close)
    r3.on('closed', close)

    var counter = 0
    
    function close(t) {
      if (++counter == 2) {
        rmrf(datadir, function() {
          setTimeout(function() {
            done()
          }, 500)
        })
      }
    }

    db[0].put('testkey', 'testvalue', function(err) {
      ASSERT(!err, 'key put into database db0')

      setTimeout(after1, 2000)

      function after1() {

        db[1].get('testkey', function(err, value) {
          ASSERT(value, 'key found in database db1')

          setTimeout(after2, 1000)
        })
      }

      function after2() {

        db[2].get('testkey', function(err, value) {
          ASSERT(value, 'key found in database db2')
          r1.close()
          r2.close()
          r3.close()
        })
      }
    })
  })

  it('replicate between multiple servers (one peer with bad credentials)', function (done) {

    fs.mkdirSync(datadir)

    var db = [
      level(datadir + '/db0', configDB), 
      level(datadir + '/db1', configDB),
      level(datadir + '/db2', configDB)
    ]

    var rs = [
      level(datadir + '/rs0', configDB),
      level(datadir + '/rs1', configDB),
      level(datadir + '/rs2', configDB)
    ]

    config1.pems = config2.pems = pemsdir + '/pems.json'
    config3.pems = pemsdir + '/pems-alt.json'

    config1.identify = config2.identify = config3.identify = function (id) {
      this.public == id.key.public ? id.accept() : id.reject()
    }

    var r1
    var r2
    var r3

    setTimeout(function() {
      r1 = r.server(db[0], rs[0], config1)
      r1.on('error', noop)
      r1.on('closed', close)
    }, Math.random()*100)

    setTimeout(function() {
      r3 = r.server(db[2], rs[2], config3)
      r3.on('error', noop)
      r3.on('closed', close)
    }, Math.random()*100)
    
    setTimeout(function() {
      r2 = r.server(db[1], rs[1], config2)
      r2.on('error', noop)
      r2.on('closed', close)
    }, Math.random()*100)

    var counter = 0

    function close(t) {
      if (++counter == 2) {
        rmrf(datadir, function() {
         rmrf(pemsdir, function() {
            done()
         })
        })
      }
    }

    setTimeout(function() {
      db[0].put('testkey0', 'testvalue0', function(err) { ASSERT(!err) })
      db[1].put('testkey1', 'testvalue1', function(err) { ASSERT(!err) })
      db[2].put('testkey2', 'testvalue2', function(err) { ASSERT(!err) })
    }, 500)

    setTimeout(after1, 1000)

    function after1() {

      db[1].get('testkey1', function(err, value) {
        ASSERT(value, 'key found in database db1')

        setTimeout(after2, 500)
      })
    }

    function after2() {

      db[0].get('testkey2', function(err, value1) {
        ASSERT(value1 == undefined, 'testkey2 was not found in database db0')

        db[1].get('testkey2', function(err, value2) {
          ASSERT(value2 == undefined, 'testkey2 key was not found in database db1')

          db[2].get('testkey0', function(err, value3) {
            ASSERT(value3 == undefined, 'testkey0 was not found in database db2')

            db[2].get('testkey1', function(err, value4) {
              ASSERT(value4 == undefined, 'testkey1 was not found in database db2')

              r1.close()
              r2.close()
              r3.close()
            })
          })
        })
      })
    }
  })

})
