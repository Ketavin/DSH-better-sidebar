/**
 * Windows ConPTY cleanup hardening owned by this package.
 *
 * node-pty 1.1.0 forks an internal helper during `IPty.kill()` to enumerate
 * every process attached to the shell console. If the shell exits before that
 * helper calls AttachConsole, the native binding throws, the child crashes to
 * the host stderr, and node-pty waits five seconds before using its existing
 * shell-PID fallback. A workspace-level pnpm patch can fix that in this repo,
 * but it does not travel with an installed npm tarball.
 *
 * The pinned node-pty implementation exposes its Windows agent on `_agent`.
 * For Windows PTYs only, replace the agent's process-list resolver with this
 * package's shipped, crash-safe helper. Other platforms and future node-pty
 * implementations without that seam are untouched.
 */
import { fork, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IPty } from 'node-pty'

const CLEANUP_TIMEOUT_MS = 5_000

interface WindowsPtyAgentInternals {
  _innerPid?: number
  _getConsoleProcessList?: () => Promise<number[]>
}

interface WindowsPtyInternals extends IPty {
  _agent?: WindowsPtyAgentInternals
}

export type ConsoleProcessListResolver = (shellPid: number) => Promise<number[]>

/** Resolve the helper shipped in both source checkouts and packed installs. */
export function conptyCleanupHelperPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'conpty-console-list-agent.cjs')
}

/** Resolve node-pty's lib directory without importing its native binding. */
export function nodePtyLibPath(): string {
  const require = createRequire(import.meta.url)
  return dirname(require.resolve('node-pty'))
}

/**
 * Query the console process list in the isolated helper. Every helper failure
 * resolves to `[shellPid]`; cleanup must remain total and must never emit an
 * unhandled child-process error into the host.
 */
export function resolveConsoleProcessList(
  shellPid: number,
  options: {
    helperPath?: string
    nodePtyLib?: string
    timeoutMs?: number
    forkProcess?: typeof fork
  } = {},
): Promise<number[]> {
  if (!Number.isInteger(shellPid) || shellPid <= 0) return Promise.resolve([])
  const helperPath = options.helperPath ?? conptyCleanupHelperPath()
  const nodePtyLib = options.nodePtyLib ?? nodePtyLibPath()
  const timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS
  const forkProcess = options.forkProcess ?? fork

  return new Promise(resolve => {
    let child: ChildProcess | undefined
    let settled = false
    let reportedProcesses: number[] | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (processes: number[]): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(processes)
    }
    try {
      child = forkProcess(helperPath, [String(shellPid), nodePtyLib], { silent: true })
      child.once('message', message => {
        const value = (message as { consoleProcessList?: unknown } | null)?.consoleProcessList
        // GetConsoleProcessList can include the isolated probe itself and,
        // on some hosted Windows console arrangements, the Node host or its
        // launcher. None of those are terminal descendants. Never return a
        // PID that could terminate the DSH process, its supervisor, or the
        // helper after its PID is recycled.
        const protectedPids = new Set([process.pid, process.ppid, child?.pid])
        const rawProcesses = Array.isArray(value)
          ? value.filter((pid): pid is number => Number.isInteger(pid) && pid > 0)
          : []
        const processes = rawProcesses
          .filter(pid => (
              Number.isInteger(pid) && pid > 0 && !protectedPids.has(pid)
            ))
        if (process.env.DSH_CONPTY_DEBUG === '1') {
          console.error('[dsh-conpty-cleanup]', JSON.stringify({
            shellPid,
            hostPid: process.pid,
            parentPid: process.ppid,
            helperPid: child?.pid,
            rawProcesses,
            processes,
          }))
        }
        // The helper is attached to the target console while it probes the
        // process list, so its own PID can be part of the result. Do not hand
        // that list back to node-pty until the helper has completed its IPC
        // flush and exited; otherwise node-pty can race to terminate the
        // still-running helper and make the host/test worker exit non-zero.
        reportedProcesses = processes.length > 0
          ? processes
          : protectedPids.has(shellPid) ? [] : [shellPid]
      })
      child.once('error', () => { finish([shellPid]) })
      child.once('exit', () => { finish(reportedProcesses ?? [shellPid]) })
      timer = setTimeout(() => {
        try { child?.kill() } catch { /* already gone */ }
        finish([shellPid])
      }, Math.max(1, timeoutMs))
      if (typeof timer === 'object' && 'unref' in timer) timer.unref()
    } catch {
      finish([shellPid])
    }
  })
}

/**
 * Replace node-pty's crash-prone Windows console-list resolver on one PTY.
 * Returns true when the seam was present and hardened, false for non-Windows
 * or an implementation that does not expose the node-pty 1.1 agent shape.
 */
export function hardenWindowsPtyCleanup(
  pty: IPty,
  options: {
    platform?: NodeJS.Platform
    resolveList?: ConsoleProcessListResolver
  } = {},
): boolean {
  if ((options.platform ?? process.platform) !== 'win32') return false
  const agent = (pty as WindowsPtyInternals)._agent
  if (agent === undefined || typeof agent._getConsoleProcessList !== 'function') return false
  const shellPid = agent._innerPid
  if (!Number.isInteger(shellPid) || (shellPid ?? 0) <= 0) return false
  const resolveList = options.resolveList ?? resolveConsoleProcessList
  agent._getConsoleProcessList = () => resolveList(shellPid!)
  return true
}
