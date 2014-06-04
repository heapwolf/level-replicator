# SYNOPSIS
A simple eventually consistent master-master replication module for leveldb.

# BUILD STATUS
[![build-status](https://www.codeship.io/projects/0d604520-6cc1-0131-203c-22ccfa4c21c9/status)](https://www.codeship.io/projects/13128)

## OVERVIEW
Each database maintains a `CHANGE LOG` in a separate sub-level. The change log
is based on the Lamport Timestamp for determining order after distribution.

## ALGORITHM
- If a write operation (a put or delete) is committed to the local database
  for the first time.

  - A sequential log is created (the log specifies the type of operation and
    a logical clock set at `0`).
  - The new key, value and log are atomically committed to the local database
    in a batch operation.

- If an update operation (a put or delete) is committed to the local database.

  - Its log is looked up, the operation is documented and the logical clock
    is incremented and a new log is created.
  - The key, value and log are atomically committed to the database
    in a batch operation.

- If a write or update operation occurs, the frequently at which the local
  database will try to connect to remote databases increases.

- When the database connects, it reads the logs from the remote database in
  reverse until it finds a log that it already has.

  - The latest log for each key is placed into memory and then iterated over.
    - If the log does not exist locally, its corresponding key/value is 
      committed to the local database.
    - If the log exists locally and its clock is earlier, a new log is created
      with a clock set to one greater than the maximum of the local and remote
      clock's value. Its corresponding value is introduced to the database.
    - If the log exists and it's local clock is greater than the remote's clock
      the log is purged.

## COMPLEXITY
Most likely `O(n!)`.

## TODO

The changes log could have an expiration policy.

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

