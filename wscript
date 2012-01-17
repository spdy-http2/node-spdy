import Options
from node_addon import node_addon_shlib_ext
from os.path import exists
from shutil import copy2 as copy

def set_options(opt):
  opt.tool_options("compiler_cxx")

def configure(conf):
  conf.check_tool("compiler_cxx")
  conf.check_tool("node_addon")

def build_task(bld, name, source):
  obj = bld.new_task_gen("cxx", "shlib", "node_addon")

  if Options.platform == "darwin":
    obj.cxxflags = ["-g", "-D_LARGEFILE_SOURCE", "-Wall", "-arch", "i386"]
    obj.ldflags = ["-arch", "i386"]
    obj.env['DEST_CPU'] = 'i386'
  else:
    obj.cxxflags = ["-g", "-D_LARGEFILE_SOURCE", "-Wall"]

  obj.target = name
  obj.source = source
  obj.includes = "src/"

def build(bld):
  build_task(bld, 'generic', 'src/generic.cc')
  build_task(bld, 'v2-protocol', 'src/v2/protocol.cc')

def unlink_target(target):
  file = '%s.node' % target
  if exists(file):
    unlink(file)

def copy_built(target, dst_name):
  built = 'build/Release/%s.node' % target
  dest = 'lib/spdy/protocol/%s.node' % dst_name
  if exists(built):
    copy(built, dest)

def shutdown(context):
  if Options.commands['clean']:
    unlink_target('generic')
    unlink_target('parser')
  else:
    copy_built('generic', 'generic')
    copy_built('v2-protocol', 'v2/protocol')
