import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import type { ChildProcess, fork } from 'node:child_process'
import type { IPty } from 'node-pty'
import { describe, expect, it, vi } from 'vitest'
import {
  conptyCleanupHelperPath,
  hardenWindowsPtyCleanup,
  nodePtyLibPath,
  resolveConsoleProcessList,
} from '../src/windows-pty-cleanup.ts'

describe('node-pty AttachConsole fallback', () => {
  it('ships the crash-safe helper in the package file manifest', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { files?: string[] }
    const helper = readFileSync(conptyCleanupHelperPath(), 'utf8')

    expect(pkg.files).toContain('scripts/conpty-console-list-agent.cjs')
    expect(helper).toContain('consoleProcessList = [shellPid]')
  })

  it('the shipped helper returns a dead shell PID without crashing', async () => {
    const deadPid = 2_147_483_647
    await expect(resolveConsoleProcessList(deadPid, {
      helperPath: conptyCleanupHelperPath(),
      nodePtyLib: nodePtyLibPath(),
      timeoutMs: 5_000,
    })).resolves.toEqual([deadPid])
  })

  it('waits for the helper to exit before exposing its process list', async () => {
    const child = new EventEmitter() as ChildProcess
    const forkProcess = (() => child) as typeof fork
    const resolved = vi.fn()
    const result = resolveConsoleProcessList(321, {
      helperPath: 'fixture-helper.cjs',
      nodePtyLib: 'fixture-node-pty-lib',
      timeoutMs: 5_000,
      forkProcess,
    })
    void result.then(resolved)

    child.emit('message', { consoleProcessList: [321, 654] })
    await Promise.resolve()
    expect(resolved).not.toHaveBeenCalled()

    child.emit('exit', 0, null)
    await expect(result).resolves.toEqual([321, 654])
  })

  it('replaces the node-pty 1.1 Windows agent resolver', async () => {
    const resolveList = vi.fn(async (pid: number) => [pid, pid + 1])
    const agent = {
      _innerPid: 321,
      _getConsoleProcessList: async () => [999],
    }
    const pty = { _agent: agent } as unknown as IPty

    expect(hardenWindowsPtyCleanup(pty, { platform: 'win32', resolveList })).toBe(true)
    await expect(agent._getConsoleProcessList()).resolves.toEqual([321, 322])
    expect(resolveList).toHaveBeenCalledWith(321)
  })

  it('does not touch non-Windows PTYs or unknown node-pty shapes', () => {
    const agent = { _innerPid: 321, _getConsoleProcessList: async () => [999] }
    const pty = { _agent: agent } as unknown as IPty
    const original = agent._getConsoleProcessList

    expect(hardenWindowsPtyCleanup(pty, { platform: 'linux' })).toBe(false)
    expect(agent._getConsoleProcessList).toBe(original)
    expect(hardenWindowsPtyCleanup({} as IPty, { platform: 'win32' })).toBe(false)
  })
})
