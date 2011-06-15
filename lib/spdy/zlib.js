/**
 * Zlib wrapper
 */

var Buffer = require('buffer').Buffer,
    ZLibContext = require('zlibcontext').ZLibContext;

var flatDictStr = [
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
    '.1statusversionurl'
  ].join(''),
  flatDict = new Buffer(flatDictStr.length + 1);

flatDict.write(flatDictStr, 'ascii');
flatDict[flatDict.length - 1] = 0;

var ZLib = exports.ZLib = function(options) {
  options || (options = {use_dictionary: true});

  this.context = options.use_dictionary ?
      new ZLibContext(flatDict)
      :
      new ZLibContext();
};

exports.createZLib = function(options) {
  return new ZLib(options);
};

ZLib.prototype.deflate = function(buffer) {
  return this.context.deflate(buffer);
};

ZLib.prototype.inflate = function(buffer) {
  return this.context.inflate(buffer);
};

