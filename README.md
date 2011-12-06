# SPDY Server for node.js

With this module you can create [SPDY](http://www.chromium.org/spdy) servers
in node.js with natural http module interface and fallback to regular https
(for browsers that doesn't support SPDY yet).

It's using SSL's NPN feature that is available in node from 0.6.0 version, but
requires you to build node with latest openssl.

## Node+OpenSSL building

At the moment node-spdy requires zlib dictionary support which will come to
node.js only in 0.7.x version.

```bash
# Download and build zlib (you'll need to install it globally)
wget http://www.zlib.net/zlib-1.2.5.tar.gz
tar -xzvf zlib-1.2.5.tar.gz
cd zlib-1.2.5
./configure
sudo make install

# Download and build openssl
wget ftp://ftp.openssl.org/snapshot/openssl-1.0.1-stable-SNAP-20111206.tar.gz
tar -xzvf openssl-1.0.1-stable-SNAP-20111206
cd openssl-1.0.1-stable-SNAP-20111206
./config shared zlib --prefix=~/.local/openssl # add -fPIC if you're on x86-64
make depend
make
make install

# Allow dynamic linking to custom version of openssl
echo 'export LD_LIBRARY_PATH=$HOME/.local/openssl/lib:$LD_LIBRARY_PATH' >> .bashrc

# Download and build node
wget http://nodejs.org/dist/v0.7.0/node-v0.7.0.tar.gz
tar -xzvf node-v0.7.0.tar.gz
cd node-v0.7.0
./configure --prefix=$HOME/.local/node/npn \
    --openssl-includes=$HOME/.local/openssl/include \
    --openssl-libpath=$HOME/.local/openssl/lib
make -j4 # If you have 4 CPU cores
make install

# Add node's bin to PATH
echo 'export PATH=$HOME/.local/node/npn/bin:$PATH' >> .bashrc
```

## Usage

```javascript
var spdy = require('spdy');

var options = {
  key: fs.readFileSync(__dirname + '/../keys/spdy-key.pem'),
  cert: fs.readFileSync(__dirname + '/../keys/spdy-cert.pem'),
  ca: fs.readFileSync(__dirname + '/../keys/spdy-csr.pem')
};

spdy.createServer(options, function(req, res) {
  res.writeHead(200);
  res.end('hello world!');
});

spdy.listen(443);
```

## Helping project

Node-spdy is open for donations, please feel free to contact me for any futher information: fedor@indutny.com

#### Contributors

* [Fedor Indutny](https://github.com/indutny)
* [Chris Storm](https://github.com/eee-c)
* [François de Metz](https://github.com/francois2metz)

#### LICENSE

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

