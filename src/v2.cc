#include <v8.h>
#include <node.h>
#include <node_buffer.h>
#include <stdio.h>

#include "spdy.h"
#include "v2.h"

namespace spdy {

using namespace v8;
using namespace node;

Handle<Value> Framer::New(const Arguments& args) {
  Framer* f = new Framer();
  f->Wrap(args.Holder());

  return args.This();
}

Handle<Value> Framer::Execute(const Arguments& args) {
  return Undefined();
}

Handle<Value> Framer::DataFrame(const Arguments& args) {
  return Undefined();
}

Handle<Value> Framer::MaxStreamsFrame(const Arguments& args) {
  return Undefined();
}

Handle<Value> Framer::PingFrame(const Arguments& args) {
  return Undefined();
}

Handle<Value> Framer::ReplyFrame(const Arguments& args) {
  return Undefined();
}

Handle<Value> Framer::RstFrame(const Arguments& args) {
  return Undefined();
}

Handle<Value> Framer::StreamFrame(const Arguments& args) {
  return Undefined();
}

void Initialize(Handle<Object> target) {
  Local<FunctionTemplate> t = FunctionTemplate::New(Framer::New);
  Persistent<FunctionTemplate>::New(t);

  t->InstanceTemplate()->SetInternalFieldCount(1);
  t->SetClassName(String::NewSymbol("Framer"));

  NODE_SET_PROTOTYPE_METHOD(t, "execute", Framer::Execute);
  NODE_SET_PROTOTYPE_METHOD(t, "dataFrame", Framer::DataFrame);
  NODE_SET_PROTOTYPE_METHOD(t, "maxStreamsFrame", Framer::MaxStreamsFrame);
  NODE_SET_PROTOTYPE_METHOD(t, "pingFrame", Framer::PingFrame);
  NODE_SET_PROTOTYPE_METHOD(t, "replyFrame", Framer::ReplyFrame);
  NODE_SET_PROTOTYPE_METHOD(t, "rstFrame", Framer::RstFrame);
  NODE_SET_PROTOTYPE_METHOD(t, "streamFrame", Framer::StreamFrame);

  target->Set(String::NewSymbol("Framer"), t->GetFunction());
}

NODE_MODULE(v2, Initialize)

} // spdy
