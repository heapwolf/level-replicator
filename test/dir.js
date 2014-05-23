module.exports = dir

// Utility function for debugging
function dir(db, name) {
  name = name || db.location || '<unknown>'

  var results = []
  db.createReadStream()
  .on('data', function(D) { results.push(D) })
  .on('end', function() {
    console.log('=-=-=-=-= %s', name)
    for (var i = 0; i < results.length; i++)
      console.log('%s = %j', results[i].key, results[i].value)
    console.log('=-=-=-=-=')
  })
}
