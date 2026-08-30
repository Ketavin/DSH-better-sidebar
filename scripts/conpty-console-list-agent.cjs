'use strict'

/**
 * Isolated Windows ConPTY process-list probe used by the plugin's node-pty
 * cleanup hardening. node-pty performs this query in a child process because
 * AttachConsole mutates process-global console state. A shell can exit between
 * scheduling the probe and attaching to its console; that race is normal, so
 * return the shell PID as the same conservative fallback node-pty uses after
 * its five-second timeout instead of crashing the helper into DSH stderr.
 */
const path = require('node:path')

const shellPid = Number.parseInt(process.argv[2] ?? '', 10)
const nodePtyLib = process.argv[3]
let consoleProcessList = []

if (Number.isInteger(shellPid) && shellPid > 0 && typeof nodePtyLib === 'string' && nodePtyLib !== '') {
  try {
    const utils = require(path.join(nodePtyLib, 'utils.js'))
    const getConsoleProcessList = utils.loadNativeModule('conpty_console_list').module.getConsoleProcessList
    consoleProcessList = getConsoleProcessList(shellPid)
  } catch {
    consoleProcessList = [shellPid]
  }
}

if (typeof process.send === 'function') {
  // Do not exit until Node confirms that the IPC payload was flushed. The
  // parent deliberately waits for this clean exit before node-pty starts
  // terminating the returned console-process list.
  process.send({ consoleProcessList }, () => { process.exit(0) })
} else {
  process.exit(0)
}
