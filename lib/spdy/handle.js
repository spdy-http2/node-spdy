function Handle(stream) {
  this._stream = stream;
}
module.exports = Handle;

Handle.prototype.readStart = function readStart() {
};

Handle.prototype.readStop = function readStop() {
};

Handle.prototype.writeBuffer = function writeBuffer(req, data) {
  req.async = true;

  this.framer.dataFrame({
    id: this.id,
    priority: this.priority,
    fin: false,
    data: data
  });
};

Handle.prototype.writeBinaryString = function writeBinaryString(req, data) {
  return this.writeBuffer(req, new Buffer(data, 'binary'));
};

Handle.prototype.writeUtf8String = function writeUtf8String(req, data) {
  return this.writeBuffer(req, new Buffer(data, 'utf8'));
};

Handle.prototype.writeAsciiString = function writeAsciiString(req, data) {
  return this.writeBuffer(req, new Buffer(data, 'ascii'));
};

Handle.prototype.writeUcs2String = function writeUcs2String(req, data) {
  return this.writeBuffer(req, new Buffer(data, 'ucs2'));
};

Handle.prototype.shutdown = function shutdown(req) {
  this.framer.dataFrame({
    id: this.id,
    priority: this.priority,
    fin: true,
    data: new Buffer(0)
  });

  process.nextTick(function() {
    req.oncomplete();
  });
};

Handle.prototype.close = function close(cb) {
  process.nextTick(cb);
};
