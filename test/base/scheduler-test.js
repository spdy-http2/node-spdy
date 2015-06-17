var assert = require('assert');

var spdy = require('../../');
var base = spdy.protocol.base;

describe('Frame Scheduler', function() {
  var scheduler;
  beforeEach(function() {
    scheduler = base.Scheduler.create();
  });

  function chunk(stream, priority, chunks) {
    return {
      stream: stream,
      priority: priority,
      chunks: chunks
    };
  }

  function expect(string, done) {
    var actual = '';
    scheduler.on('data', function(chunk) {
      actual += chunk;
      if (scheduler.pendingCount !== 0)
        return;

      assert.equal(actual, string);
      done();
    });
  }

  it('should schedule and emit one frame', function(done) {
    scheduler.write(chunk(0, 0, [ 'hello', ' ', 'world' ]));

    expect('hello world', done);
  });

  it('should schedule and emit two frames', function(done) {
    scheduler.write(chunk(0, 0, [ 'hello', ' ' ]));
    scheduler.write(chunk(0, 0, [ 'world' ]));

    expect('hello world', done);
  });

  it('should interleave between two streams', function(done) {
    scheduler.write(chunk(0, 0, [ 'hello ' ]));
    scheduler.write(chunk(0, 0, [ ' hello ' ]));
    scheduler.write(chunk(1, 0, [ 'world!' ]));
    scheduler.write(chunk(1, 0, [ 'world' ]));

    expect('hello world! hello world', done);
  });

  it('should interleave between two shuffled streams', function(done) {
    scheduler.write(chunk(0, 0, [ 'hello ' ]));
    scheduler.write(chunk(1, 0, [ 'world!' ]));
    scheduler.write(chunk(1, 0, [ 'world' ]));
    scheduler.write(chunk(0, 0, [ ' hello ' ]));

    expect('hello world! hello world', done);
  });

  it('should interleave between three streams', function(done) {
    scheduler.write(chunk(0, 0, [ 'hello ' ]));
    scheduler.write(chunk(1, 0, [ 'world!' ]));
    scheduler.write(chunk(1, 0, [ 'world' ]));
    scheduler.write(chunk(0, 0, [ ' hello ' ]));
    scheduler.write(chunk(2, 0, [ 'someone\'s ' ]));

    expect('hello world! hello someone\'s world', done);
  });
});
