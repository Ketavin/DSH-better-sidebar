import { fork } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('node-pty AttachConsole fallback', () => {
  it('keeps the node-pty patch pinned in the workspace', () => {
    const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const patch = readFileSync(new URL('../patches/node-pty@1.1.0.patch', import.meta.url), 'utf8')

    expect(workspace).toContain('node-pty@1.1.0: patches/node-pty@1.1.0.patch')
    expect(patch).toContain('consoleProcessList = [shellPid]')
  })

  const windowsIt = process.platform === 'win32' ? it : it.skip

  windowsIt('returns the dead shell PID without stderr or a child-process crash', async () => {
    const require = createRequire(import.meta.url)
    const entry = require.resolve('node-pty')
    const helper = join(dirname(entry), 'conpty_console_list_agent.js')
    const deadPid = 2_147_483_647
    const child = fork(helper, [String(deadPid)], { silent: true })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', chunk => { stderr += chunk })

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('node-pty cleanup helper timed out')), 5_000).unref()
    })
    const message = await Promise.race([
      new Promise<unknown>((resolve, reject) => {
        child.once('message', resolve)
        child.once('error', reject)
      }),
      timeout,
    ])
    const exit = await Promise.race([
      new Promise<{ code: number | null, signal: NodeJS.Signals | null }>(resolve => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
      }),
      timeout,
    ])

    expect(message).toEqual({ consoleProcessList: [deadPid] })
    expect(exit).toEqual({ code: 0, signal: null })
    expect(stderr).toBe('')
  })
})
