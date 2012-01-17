#include <v8.h>
#include <node.h>
#include <node_buffer.h>
#include <stdio.h>

#include "spdy.h"

#define UNWRAP(x) \
    Local<Object> buff = args[x]->ToObject();\
    uint8_t* data = reinterpret_cast<uint8_t*>(Buffer::Data(buff));\
    size_t data_len = Buffer::Length(buff);\
    Local<Object> result = Object::New();

namespace spdy {

using namespace v8;
using namespace node;

// parseSynHead (type, flags, data)
Handle<Value> ParseSynHead(const Arguments& args) {
  HandleScope scope;

  uint16_t type = static_cast<uint16_t>(args[0].As<Number>()->Value());
  uint8_t flags = static_cast<uint8_t>(args[1].As<Number>()->Value());
  UNWRAP(2);

  bool syn_stream = type == 0x01;
  uint32_t id = readUInt32(data) & 0x7fffffff;
  uint32_t associated = syn_stream ? (readUInt32(data + 4) & 0x7fffffff) : 0;
  uint8_t priority = syn_stream ? (data[8] >> 6) : 0;
  bool fin = (flags & 0x01) == 0x01;
  bool unidir = (flags & 0x02) == 0x02;
  uint16_t offset = syn_stream ? 10 : 6;

  result->Set(String::NewSymbol("type"),
              syn_stream ?
                  String::NewSymbol("SYN_STREAM")
                  :
                  String::NewSymbol("SYN_REPLY"));
  result->Set(String::NewSymbol("id"), Number::New(id));
  result->Set(String::NewSymbol("associated"), Number::New(associated));
  result->Set(String::NewSymbol("priority"), Number::New(priority));
  result->Set(String::NewSymbol("fin"), fin ? True() : False());
  result->Set(String::NewSymbol("unidir"), unidir ? True() : False());
  result->Set(String::NewSymbol("_offset"), Number::New(offset));

  return scope.Close(result);
}


Handle<Value> ParseHeaders(const Arguments& args) {
  HandleScope scope;

  UNWRAP(0);

  uint16_t size = readUInt16(data);
  // Prevent oob errors
  data += 2;
  data_len -= 2;

  while (size > 0) {
    uint16_t size;
    if (data_len <= 0) return scope.Close(result);

    // Key
    size = readUInt16(data);

    data += 2;
    data_len -= 2;
    if (data_len < size) return scope.Close(result);

    Local<String> key = String::New(reinterpret_cast<char*>(data), size);
    data += size;
    data_len -= size;

    // Value
    size = readUInt16(data);

    data += 2;
    data_len -= 2;
    if (data_len < size) return scope.Close(result);

    Local<String> value = String::New(reinterpret_cast<char*>(data), size);
    data += size;
    data_len -= size;

    result->Set(key, value);
  }

  return scope.Close(result);
}


Handle<Value> ParseRst(const Arguments& args) {
  HandleScope scope;

  UNWRAP(0);

  uint32_t id = readUInt32(data) & 0x7fffffff;
  uint32_t status = readUInt32(data + 4);

  result->Set(String::NewSymbol("type"), String::NewSymbol("RST_STREAM"));
  result->Set(String::NewSymbol("id"), Number::New(id));
  result->Set(String::NewSymbol("status"), Number::New(status));

  return scope.Close(result);
}


Handle<Value> ParseGoaway(const Arguments& args) {
  HandleScope scope;

  UNWRAP(0);

  uint32_t last_id = readUInt32(data) & 0x7fffffff;

  result->Set(String::NewSymbol("type"), String::NewSymbol("GOAWAY"));
  result->Set(String::NewSymbol("lastId"), Number::New(last_id));

  return scope.Close(result);
}


void Initialize(Handle<Object> target) {
  NODE_SET_METHOD(target, "parseSynHead", ParseSynHead);
  NODE_SET_METHOD(target, "parseHeaders", ParseHeaders);
  NODE_SET_METHOD(target, "parseRst", ParseRst);
  NODE_SET_METHOD(target, "parseGoaway", ParseGoaway);
}

NODE_MODULE(protocol, Initialize)

} // spdy
