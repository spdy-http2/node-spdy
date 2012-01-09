var utils = exports;

var zlib = require('zlib'),
    Buffer = require('buffer').Buffer;

// SPDY deflate/inflate dictionary
var dictionary = new Buffer([
  'optionsgetheadpostputdeletetraceacceptaccept-charsetaccept-encodingaccept-',
  'languageauthorizationexpectfromhostif-modified-sinceif-matchif-none-matchi',
  'f-rangeif-unmodifiedsincemax-forwardsproxy-authorizationrangerefererteuser',
  '-agent10010120020120220320420520630030130230330430530630740040140240340440',
  '5406407408409410411412413414415416417500501502503504505accept-rangesageeta',
  'glocationproxy-authenticatepublicretry-afterservervarywarningwww-authentic',
  'ateallowcontent-basecontent-encodingcache-controlconnectiondatetrailertran',
  'sfer-encodingupgradeviawarningcontent-languagecontent-lengthcontent-locati',
  'oncontent-md5content-rangecontent-typeetagexpireslast-modifiedset-cookieMo',
  'ndayTuesdayWednesdayThursdayFridaySaturdaySundayJanFebMarAprMayJunJulAugSe',
  'pOctNovDecchunkedtext/htmlimage/pngimage/jpgimage/gifapplication/xmlapplic',
  'ation/xhtmltext/plainpublicmax-agecharset=iso-8859-1utf-8gzipdeflateHTTP/1',
  '.1statusversionurl\0'
].join(''));

//
// ### function createDeflate ()
// Creates deflate stream with SPDY dictionary
//
utils.createDeflate = function createDeflate() {
  var deflate = zlib.createDeflate({ dictionary: dictionary});

  // Define lock information early
  deflate.locked = false;
  deflate.lockBuffer = [];

  return deflate;
};

//
// ### function createInflate ()
// Creates inflate stream with SPDY dictionary
//
utils.createInflate = function createInflate() {
  var inflate = zlib.createInflate({ dictionary: dictionary});

  // Define lock information early
  inflate.locked = false;
  inflate.lockBuffer = [];

  return inflate;
};

//
// ### function zstream (stream, buffer, callback)
// #### @stream {Deflate|Inflate} One of streams above
// #### @buffer {Buffer} Input data (to compress or to decompress)
// #### @callback {Function} Continuation to callback
// Compress/decompress data and pass it to callback
//
utils.zstream = function zstream(stream, buffer, callback) {
  var flush = stream._flush,
      chunks = [],
      total = 0;

  if (stream.locked) {
    stream.lockBuffer.push(function deferred() {
      utils.zstream(stream, buffer, callback);
    });
    return;
  }
  stream.locked = true;

  function collect(chunk) {
    chunks.push(chunk);
    total += chunk.length;
  };
  stream.on('data', collect);
  stream.write(buffer);
  stream.flush(function() {
    stream.removeListener('data', collect);

    stream._flush = flush;
    callback(null, chunks, total);

    stream.locked = false;
    var deferred = stream.lockBuffer.shift();

    if (deferred) deferred();
  });
};
