#ifndef SPDY_SRC_V2_H_
#define SPDY_SRC_V2_H_

#include <v8.h>
#include <node.h>
#include <node_object_wrap.h>

namespace spdy {

using namespace v8;
using namespace node;

class Framer : ObjectWrap {
 public:
  static Handle<Value> New(const Arguments& args);

  static Handle<Value> Execute(const Arguments& args);
  static Handle<Value> DataFrame(const Arguments& args);
  static Handle<Value> MaxStreamsFrame(const Arguments& args);
  static Handle<Value> PingFrame(const Arguments& args);
  static Handle<Value> ReplyFrame(const Arguments& args);
  static Handle<Value> RstFrame(const Arguments& args);
  static Handle<Value> StreamFrame(const Arguments& args);
};


} // spdy

#endif // SPDY_SRC_V2_H_
