# SPDY Server on node.js (BETA)

With that module you can create true SPDY servers with natural http module
interface and fallback to HTTPS (for browsers that doesn't support SPDY).

It's using SSL's NPN feature that will be available in node.js from 0.5.0-pre
version, but you'll need to compile it with latest available version of OpenSSL

1. grab http://cvs.openssl.org
2. build it
2. build node.js with that version of openssl

    ./configure --openssl-includes=/path/to/openssl/include \
                --openssl-libpath=/path/to/openssl
    make install

3. have fun with SPDY and node.js! 

## Usage

    var options = {
      key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
      cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
      ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem'),
      NPNProtocols: ['spdy/2']
    };

    spdy.createServer(options, function(req, res) {
      res.writeHead(200);
      res.end('hello world!');
    });

As you can see it provides well known req/res interface for handling requests
and responding to them.

## LICENSE
