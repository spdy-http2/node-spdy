# SPDY Server on node.js (BETA)

Required node.js version - at least 0.5.0-pre.

Because of libuv integration in node.js core latest version of one is not usable, try this checking out at this commit instead: https://github.com/joyent/node/commit/9812e31

With that module you can create true [SPDY](http://www.chromium.org/spdy) servers with natural http module interface and fallback to HTTPS (for browsers that doesn't support SPDY).

It's using SSL's NPN feature that will be available in node.js from 0.5.0-pre version, but you'll need to compile it with latest available version of OpenSSL.

Instruction for setting up development environment can be found in @eee-c article here: http://japhr.blogspot.com/2011/06/setting-up-node-spdy.html

## Alternative instructions

1. grab http://cvs.openssl.org
2. build it
3. build node.js with that version of openssl

    ./configure --openssl-includes=/path/to/openssl/include \
                --openssl-libpath=/path/to/openssl
    make install

4. have fun with SPDY and node.js! 

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

This software is licensed under the MIT License.

Copyright Fedor Indutny, 2011.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the
following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
USE OR OTHER DEALINGS IN THE SOFTWARE.

