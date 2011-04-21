# SPDY Server on node.js (BETA)

With that module you can create true SPDY servers with natural http module
interface and fallback to HTTPS (for browsers that doesn't support SPDY).

It's using SSL's NPN feature that will be available in node.js from 0.5.0-pre
version, but you'll need to compile it with latest available version of OpenSSL
(grab http://cvs.openssl.org , and run:

    ./configure --openssl-includes=/path/to/openssl/include \
                --openssl-libpath=/path/to/openssl
)

