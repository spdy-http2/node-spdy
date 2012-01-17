#include <v8.h>
#include <node.h>
#include <node_buffer.h>
#include <stdio.h>

#include "spdy.h"

namespace spdy {

using namespace v8;
using namespace node;

Handle<Value> ParseHeader(const Arguments& args) {
  HandleScope scope;

  Local<Object> buff = args[0]->ToObject();
  uint8_t* data = reinterpret_cast<uint8_t*>(Buffer::Data(buff));

  Local<Object> result = Object::New();

  bool control = (data[0] & 0x80) == 0x80;
  result->Set(String::NewSymbol("control"), control ? True() : False());

  if (control) {
    uint16_t version = readUInt16(data) & 0x7fff;
    uint16_t type = readUInt16(data + 2);

    result->Set(String::NewSymbol("version"), Number::New(version));
    result->Set(String::NewSymbol("type"), Number::New(type));
  } else {
    uint32_t id = readUInt32(data) & 0x7fffffff;
    result->Set(String::NewSymbol("id"), Number::New(id));
  }

  uint8_t flags = data[4];
  uint32_t length = readUInt24(data + 5);
  result->Set(String::NewSymbol("flags"), Number::New(flags));
  result->Set(String::NewSymbol("length"), Number::New(length));

  return scope.Close(result);
}

void Initialize(Handle<Object> target) {
  NODE_SET_METHOD(target, "parseHeader", ParseHeader);
}

NODE_MODULE(generic, Initialize)

}
