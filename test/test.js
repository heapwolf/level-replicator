var test = require('tap').test
var level = require('level')
var r = require('../index')
var rmrf = require('rimraf')

var config0 = {
  valueEncoding: 'json'
}

var config1 = {
  "servers": {
    "127.0.0.1:8001": {},
    "127.0.0.1:8002": {}
  },
  "port": 8000
}

var config2 = {
  "servers": {
    "127.0.0.1:8000": {},
    "127.0.0.1:8002": {}
  },
  "port": 8001
}

var config3 = {
  "servers": { 
    "127.0.0.1:8000": {},
    "127.0.0.1:8001": {}
  },
  "port": 8002
}

var datadir = __dirname + '/data'

test('replicate between multiple servers (eventual consistentcy)', function (t) {

  var db1 = level(datadir + '/db1', config0)
  var db2 = level(datadir + '/db2', config0)
  var db3 = level(datadir + '/db3', config0)
  var rs1 = level(datadir + '/rs1', config0)
  var rs2 = level(datadir + '/rs2', config0)
  var rs3 = level(datadir + '/rs3', config0)

  var r1 = r.server(db1, rs1, config1)
  var r2 = r.server(db2, rs2, config2)
  var r3 = r.server(db3, rs3, config3)

  t.test('add data to db1 and expect it exists on db2 and db3 after t seconds', function (t) {
    t.plan(3)

    db1.put('testkey', 'testvalue', function(err) {
      t.ok(!err, err || 'key put into database db1')

      setTimeout(function() {
        db2.get('testkey', function(err, value) {
          t.ok(!err, err + 'db2' || 'key found in database db2')

          setTimeout(function() {
            db3.get('testkey', function(err, value) {
              t.ok(!err, err + 'db3' || 'key found in database db3')
              rmrf(datadir, function() {
                t.end()
              })
            })
          }, 500)
        })
      }, 1000)
    })
  }) 
})

test('replicate between multiple servers (strong consistentcy)', function (t) {

  var db1 = level(datadir + '/db1', config0)
  var db2 = level(datadir + '/db2', config0)
  var db3 = level(datadir + '/db3', config0)
  var rs1 = level(datadir + '/rs1', config0)
  var rs2 = level(datadir + '/rs2', config0)
  var rs3 = level(datadir + '/rs3', config0)

  var r1 = r.server(db1, rs1, config1)
  var r2 = r.server(db2, rs2, config2)
  var r3 = r.server(db3, rs3, config3)

  t.test('add data to db1 and expect it exists on db2 and db3 after t seconds', function (t) {
    t.plan(3)

    db1.put('testkey', 'testvalue', function(err) {
      t.ok(!err, err || 'key put into database db1')

      setTimeout(function() {
        db2.get('testkey', function(err, value) {
          t.ok(!err, err + 'db2' || 'key found in database db2')
          
          db3.get('testkey', function(err, value) {
            t.ok(!err, err + 'db3' || 'key found in database db3')
            rmrf(datadir, function() {
              t.end()
            })
          })
        })
      }, 1000)
    })
  })
})

