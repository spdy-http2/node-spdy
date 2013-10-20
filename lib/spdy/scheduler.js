var scheduler = exports;

//
// ### function Scheduler (connection)
// #### @connection {spdy.Connection} active connection
// Connection's streams scheduler
//
function Scheduler(connection) {
  this.connection = connection;
  this.priorities = [[], [], [], [], [], [], [], []];
  this._tickListener = null;
  this._tickCallbacks = [];
}

//
// ### function create (connection)
// #### @connection {spdy.Connection} active connection
//
exports.create = function create(connection) {
  return new Scheduler(connection);
};

//
// ### function schedule (stream, data)
// #### @stream {spdy.Stream} Source stream
// #### @data {Buffer} data to write on tick
// Use stream priority to invoke callbacks in right order
//
Scheduler.prototype.schedule = function schedule(stream, data) {
  // Ignore data from destroyed stream
  if (stream._spdyState.destroyed)
    return;
  this.scheduleLast(stream, data);
};

//
// ### function scheduleLast (stream, data)
// #### @stream {spdy.Stream} Source stream
// #### @data {Buffer} data to write on tick
// Use stream priority to invoke callbacks in right order
//
Scheduler.prototype.scheduleLast = function scheduleLast(stream, data) {
  this.priorities[stream._spdyState.priority].push(data);
};

//
// ### function tick ()
// Add .nextTick callback if not already present
//
Scheduler.prototype.tick = function tick(cb) {
  if (cb)
    this._tickCallbacks.push(cb);
  if (this._tickListener !== null)
    return;

  var self = this;
  this._tickListener = function() {
    var priorities = self.priorities;
    var tickCallbacks = self._tickCallbacks;

    self._tickListener = null;
    self.priorities = [[], [], [], [], [], [], [], []];
    self._tickCallbacks = [];

    // Run all priorities
    for (var i = 0; i < 8; i++)
      for (var j = 0; j < priorities[i].length; j++)
        self.connection.write(priorities[i][j]);

    // Invoke callbacks
    for (var i = 0; i < tickCallbacks.length; i++)
      tickCallbacks[i]();
  };

  if (this.connection._spdyState.parser.drained) {
    if (typeof setImmediate !== 'undefined')
      setImmediate(this._tickListener);
    else
      process.nextTick(this._tickListener);
  } else {
    this.connection._spdyState.parser.once('drain', this._tickListener);
  }
};
