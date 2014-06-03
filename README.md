# SYNOPSIS
A simple eventually consistent master-master replication module 
for leveldb.

# BUILD STATUS
[![build-status](https://www.codeship.io/projects/0d604520-6cc1-0131-203c-22ccfa4c21c9/status)](https://www.codeship.io/projects/13128)

## OVERVIEW
Each database maintains a `CHANGE LOG` in a separate sub-level.
Each entry in the change log has a key that matches each key in
the database appended by a lamport timestamp.

A replicating database will query a remote database's change log in reverse 
until it finds either a matching key in its own change log or the first key 
in the remote server's change log.

## ALGORITHM

## COMPLEXITY

**Average**

**Worst Case**

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
var rep = require('level-replicator')

var config = {
  servers: { // list of servers to replicate with
    "127.0.0.1:8001": {}, // a serer id and its meta data
    "127.0.0.1:8002": {} // a serer id and its meta data
  },
  port: 8000 // port for this server
}

var db = rep(level('/tmp/db'), config) 

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

var db = rep(level('/tmp/db'), config) 

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

var db = lrep(level('/tmp/db'), config) 

db.put('some-key', 'some-value', function(err) {
})
```

