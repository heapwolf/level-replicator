# SYNOPSIS
A simple eventually consistent master-master replication module 
for leveldb.

# USAGE
The install method returns an event emitter that emits important
events for optimizing the peer selection process. Also, the 
servers list is a data structure with peer selection optimization 
in mind, allowing you to store meta information about the server.

### Server 1
```js
var level = require('level')
var lrep = require('level-replicator')

var config = {
  servers: { // list of servers to replicate with
    "127.0.0.1:8001": {} // a serer id and its meta data
  },
  port: 8000 // port for this server
}

var db = level('/tmp/db') // create a datbase to replicate
var rs = level('/tmp/rs') // create a replication record set

lrep.install(db, rs, config)

// put something into the database
db.put('some-key', 'some-value', function(err) {
})
```

### Server 2
```js
var level = require('level')
var lrep = require('level-replicator')

var config = {
  servers: { // list of servers to replicate with
    "127.0.0.1:8000": {} // a server id its and meta data
  },
  port: 8001 // port for this server
}

var db = level('/tmp/db') // create a datbase to replicate
var rs = level('/tmp/rs') // create a replication record set

lrep.install(db, rs, config)

// put something into the database 
db.put('some-key', 'some-value', function(err) {
})
```

