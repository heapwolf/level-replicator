/*
 *
 * id.js
 * responsible for creating and persisting
 * the identity of the server.
 *
 */

var fs = require('fs');
var uuid = require('node-uuid');
var id_path = __dirname + '/id.txt';

module.exports = function() {

  var id;

  try {
    fs.statSync(id_path);
  }
  catch(ex) {
    id = uuid.v4();
    fs.writeFileSync(id_path, id);
    return id;
  }
  
  return fs.readFileSync(id_path).toString();
};

