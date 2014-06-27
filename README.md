# SYNOPSIS
A simple eventually consistent master-master replication module for leveldb.

# BUILD STATUS
[![build-status](https://www.codeship.io/projects/0d604520-6cc1-0131-203c-22ccfa4c21c9/status)](https://www.codeship.io/projects/13128)

## REPLICATION ALGORITHM
- If a write operation (a put or delete) is committed to the local database
  for the first time.

  - A log is created that contains the type of operation and a logical clock
    that is set at `0`. The log's key is the peer's id and a sequence.
  - An index is created (a pointer to the log for faster lookups on writes).
  - The new key/value, log and log-index are atomically committed to the local
    database.

- If an update operation (a put or delete) is committed to the local database.

  - The index is used to look up the keys corresponding log
    - The logical clock in the log is incremented
    - The type of operation is updated
    - A new log-index is created and the old one is deleted.
  - The new key/value, log and log-index are atomically committed to the local
    database.

- The frequently at which the peer will try to replicate is determined by its
  write-velocity.

- When the database connects to a peer, it reads its remote logs in reverse
  until it finds a locally known entry.

  - The latest log for each key is placed into memory and then iterated
    over to determine what should be added locally.

    - If the log does not exist locally, the log and its corresponding
      key/value is committed to the local database.
    - If the log exists locally (with an earlier clock), the remote log
      and key/value are both atomically committed.

## REPLICATON CONFLICTS
Before a local database can accept writes, it must attempt to replicate. This
will reduce the possibility for conflicts. However, in the eventual consistency
model, there is a case in which conflicts can occur. Conflicts happen when two
or more writes with the same `key` and `logical clock value` are written to two
or more servers, for example...

- `Server A` writes `foo` and a coresponding log with a logical clock of `0`.
- At a different time, without knowing about the data on `Server A`, `Server B`
  writes `foo` and a log with a logical clock of `0`.

Which write happened first? There is no reliable way to know. If this is a
possibility for you, a resolver can be used to determine which write should be
accepted. A resolver is a function can be passed into the configuration...

```js
{ resolver: function(a, b) { return a.timestamp > b.timestamp ? a : b; } }
```

## PEER DISCOVERY
Server lists are a nightmare to maintain. They also don't work well in
auto-scaling scenarios. So `level-replicator` prefers to use UDP multicast to
discover peers that it will replicate with.

Because not all VPCs support multicast and not all replication scenarios will
be within the same subnet, you may want to add known servers to a configuration,
for instance...

```json
{ servers: ['100.2.14.104:8000', '100.2.14.105:8000'] }
```

## TODO

The changes log could have an expiration policy.

## EXAMPLE: MORE THAN TWO SERVERS

### Server 1

```js
var level = require('level')
var replicate = require('level-replicator')

var db = replicate(level('/tmp/db'))

// put something into the database
db.put('some-key', 'some-value', function(err) {
})
```

### Server 2

```js
var level = require('level')
var replicate = require('level-replicator')

var db = replicate(level('/tmp/db'))

db.put('some-key', 'some-value', function(err) {
})
```

### Server 3...

```js
var level = require('level')
var replicate = require('level-replicator')

var db = replicate(level('/tmp/db'))

db.put('some-key', 'some-value', function(err) {
})
```

