
![img](/replicator.png)

# SYNOPSIS
A simple eventually consistent master-master replication module 
for leveldb.

## METHOD
### Change Logs
Each database maintains a `CHANGE LOG` in a separate level instance. 
Each entry in the change log has a key that is a monotonic timestamp
and a value that was the operation, for example...

```
{ 
  "key": "1391172544446.001",
  "value": { "type": "put", "value": "some-random-key-name" }
}
```

![img](/closeup.png)

A replicating database will query a remote database's change log in reverse 
until it finds either a matching key in its own change log or the first key 
in the remote server's change log.

![img](/faraway.png)

### Optimizations
Keeping a changes log and applying the changes in reverse means the latest
changes will be applied to the appropriate key values. If there is more than
one operation against a key,

  1. the change entry is removed by the server (*Not yet implemented*) or
  2. it is ignored by the client.

The changes log can be truncated over time to save disk space.

## EXAMPLE: MORE THAN TWO SERVERS

### Server 1
```js
var level = require('level')
var lrep = require('level-replicator')

var config = {
  servers: { // list of servers to replicate with
    "127.0.0.1:8001": {}, // a serer id and its meta data
    "127.0.0.1:8002": {} // a serer id and its meta data
  },
  port: 8000 // port for this server
}

var db = level('/tmp/db') // create a datbase to replicate
var cl = level('/tmp/cl') // create a change log database

lrep.install(db, cl, config)

// put something into the database
db.put('some-key', 'some-value', function(err) {
})
```

### Server 2

```js
var level = require('level')
var lrep = require('level-replicator')

var config = {
  servers: {
    "127.0.0.1:8000": {},
    "127.0.0.1:8002": {}
  },
  port: 8001
}

var db = level('/tmp/db')
var cl = level('/tmp/cl')

lrep.install(db, cl, config)

db.put('some-key', 'some-value', function(err) {
})
```

### Server 3...

```js
var level = require('level')
var lrep = require('level-replicator')

var config = {
  servers: { 
    "127.0.0.1:8000": {},
    "127.0.0.1:8001": {} 
  },
  port: 8002
}

var db = level('/tmp/db')
var cl = level('/tmp/cl')

lrep.install(db, cl, config)

db.put('some-key', 'some-value', function(err) {
})
```


## EXAMPLE: SECURE PEERS
Secure peers require a key pair; if you want to be fancy you could use 
[`this`][0] or [`this`][1] to crete a JSON file that includes the generated 

```js

var config = {
  servers: {
    "127.0.0.1:8001": {} 
  },
  port: 8000,
  pems: __dirname + '/pems.json'
}

config.identify = function (id) {

  //
  // you can asynchronously verify that the key matches the known value here
  //
  id.accept()
}
```

[0]:https://github.com/hij1nx/selfsigned
[1]:https://github.com/substack/rsa-json
