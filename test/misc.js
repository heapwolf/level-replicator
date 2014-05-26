exports.dir = dir
exports.mkdb = mkdb


var assert = require('assert')
var levelup = require('levelup')
var memdown = require('memdown')


function mkdb(name) {
  name = name || 'db'
  var db = levelup(name, {db:memdown})
  assert.ok(db, 'Make a db: ' + name)
  return db
}

// Utility function for debugging
function dir(db, name) {
  name = name || db.location || '<unknown>'

  var results = []
  db.createReadStream()
  .on('data', function(D) { results.push(D) })
  .on('end', function() {
    console.log('=-=-=-=-= %s', name)
    for (var i = 0; i < results.length; i++)
      console.log('%s = %s', results[i].key, results[i].value)
    console.log('=-=-=-=-=')
  })
}
