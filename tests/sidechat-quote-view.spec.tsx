// @vitest-environment jsdom
import './browser-globals.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Context } from '../src/context-types.ts'
import { api } from '../src/client/api.ts'
import { SideChatView, parkSidechatReopen } from '../src/client/SideChatView.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore } from '../src/client/state.ts'
import { registerBuiltins } from '../src/client/builtins/index.ts'
import { buildSidechatQuotePrompt, captureSidechatQuote, openSidechatQuote, sidechatQuoteFromMeta } from '../src/client/sidechat-quote.ts'
import { t } from '../src/client/locales.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement
let dispose: (() => void) | undefined
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container)
  vi.spyOn(api, 'sidechatStart').mockResolvedValue({ childId: 'child' })
  vi.spyOn(api, 'sidechatPrompt').mockResolvedValue({ accepted: true })
  vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true, status: 'idle' })
  vi.spyOn(api, 'sidechatDispose').mockResolvedValue({ accepted: true })
  vi.spyOn(api, 'sidechatCancel').mockResolvedValue({ accepted: true })
})
afterEach(() => {
  act(() => { root?.unmount() }); root = undefined; dispose?.(); dispose = undefined
  container.remove(); localStorage.clear(); vi.restoreAllMocks()
})

function setup(running = false) {
  const store = createSidebarStore(); store.setSession('parent')
  const service = createBetterSidebarService(store)
  const list = { byId: { child: { id: 'child', displayTitle: 'Side: quote', running, parentSessionId: 'parent' } }, current: 'parent' }
  const fork = vi.fn(async () => 'saved')
  const open = vi.fn()
  const ctx = {
    get: (key: string) => key === 'betterSidebar' ? service : undefined,
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => list }, fork, open },
    connection: { api: { sessions: { history: vi.fn(async () => ({ result: { ok: true, value: { events: [
      { event: { type: 'session/end-seed', seq: 1, time: 1, data: {} } },
      { event: { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } } },
    ] } } })) } } },
  } as unknown as Context
  dispose = registerBuiltins(ctx, service)
  const quote = captureSidechatQuote('source excerpt', { kind: 'file', sessionId: 'parent', path: '/work/notes.md', lines: { start: 3, end: 3 }, snapshot: 'saved' })
  expect(openSidechatQuote(service, { sessionId: 'parent' }, quote)).toBe(true)
  const tab = () => allLeaves(store.getSessionStates().get('parent')!.splits).flatMap(leaf => leaf.tabs).find(item => item.type === 'sidechat')!
  function Harness() {
    const snapshot = useSyncExternalStore(listener => service.subscribeState(listener), () => service.getSnapshot())
    const visibleTab = snapshot.state === undefined ? undefined : allLeaves(snapshot.state.splits).flatMap(leaf => leaf.tabs).find(item => item.type === 'sidechat')
    return visibleTab === undefined ? null : <SideChatView ctx={ctx} scope={{ sessionId: snapshot.sessionId! }} tab={visibleTab} visible />
  }
  root = createRoot(container)
  act(() => { root!.render(<Harness />) })
  return { store, service, tab, quote, fork, open, ctx }
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve() }) }
async function writeQuestion(value: string): Promise<void> {
  await act(async () => {
    const input = container.querySelector('textarea')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function clickTitle(title: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.title.startsWith(title) || item.textContent === title)!
  expect(button).toBeDefined()
  await act(async () => { button.click() })
}

describe('SideChat quoted draft integration', () => {
  it('creates a real child binding without sending; only explicit Send attaches the excerpt to the child prompt', async () => {
    const { tab, quote, fork, open } = setup()
    await flush()
    expect(api.sidechatStart).toHaveBeenCalledExactlyOnceWith('parent')
    expect(api.sidechatPrompt).not.toHaveBeenCalled()
    expect(sidechatQuoteFromMeta(tab().meta)).toEqual(quote)
    expect(container.textContent).toContain('/work/notes.md:3-3')
    await writeQuestion('Explain this')
    await clickTitle(t('sideChatSend'))
    expect(JSON.parse(vi.mocked(api.sidechatPrompt).mock.calls[0]![1].split('\n').find(line => line.startsWith('{'))!)).toEqual(quote)
    expect(api.sidechatPrompt).toHaveBeenCalledWith('child', expect.stringMatching(/^Explain this\n/))
    expect(sidechatQuoteFromMeta(tab().meta)).toBeUndefined()
    expect(sidechatQuoteFromMeta(tab().meta, 'quoteSource')).toEqual(quote)
    await clickTitle(t('sideChatSave'))
    expect(fork).toHaveBeenCalledWith({ sessionId: 'child', increaseTitle: true })
    expect(open).toHaveBeenCalledWith('saved')
  })

  it('keeps the question and quote after a failed send, then allows explicit removal and a plain retry', async () => {
    const { tab } = setup(); await flush()
    vi.mocked(api.sidechatPrompt).mockRejectedValueOnce(new Error('offline'))
    await writeQuestion('Explain this'); await clickTitle(t('sideChatSend'))
    expect(sidechatQuoteFromMeta(tab().meta)).toBeDefined()
    expect(container.querySelector('textarea')?.value).toBe('Explain this')
    expect(container.textContent).toContain('offline')
    await clickTitle(t('sideChatRemoveQuote')); await clickTitle(t('sideChatSend'))
    expect(api.sidechatPrompt).toHaveBeenLastCalledWith('child', 'Explain this')
  })

  it('recovers a sent quote from child history after closing and reopening without a quote seed', async () => {
    const { service, tab, quote, ctx } = setup(); await flush()
    const text = buildSidechatQuotePrompt('Explain the saved quote', quote)
    vi.mocked(ctx.connection.api.sessions.history).mockResolvedValue({ result: { ok: true, value: { events: [
      { event: { type: 'session/end-seed', seq: 1, time: 1, data: {} } },
      { event: { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } } },
    ] } } } as never)
    await act(async () => { service.closeTab(tab().id) })
    await act(async () => { parkSidechatReopen('child'); service.openTab({ type: 'sidechat' }) })
    expect(sidechatQuoteFromMeta(tab().meta)).toBeUndefined()
    expect(container.textContent).toContain('Explain the saved quote')
    expect(container.textContent).toContain('/work/notes.md')
    expect(container.textContent).not.toContain('[BEGIN QUOTED REFERENCE]')
    expect(container.querySelector('details')?.textContent).toContain('source excerpt')
    await clickTitle(t('sideChatOpenSourceFile'))
    expect(api.sidechatStart).toHaveBeenCalledTimes(1)
    expect(api.sidechatPrompt).not.toHaveBeenCalled()
  })

  it('retains cancel and close disposal for bound children', async () => {
    const { service, tab } = setup(true); await flush()
    await clickTitle(t('sideChatCancelTitle'))
    expect(api.sidechatCancel).toHaveBeenCalledWith('child')
    await act(async () => { service.closeTab(tab().id) })
    expect(api.sidechatDispose).toHaveBeenCalledWith('child')
  })

  it('disposes a child that finishes creating after its tab was closed', async () => {
    let resolve!: (value: { childId: string }) => void
    vi.mocked(api.sidechatStart).mockImplementation(() => new Promise(done => { resolve = done }))
    const { service, tab } = setup()
    await act(async () => { service.closeTab(tab().id); resolve({ childId: 'late-child' }) })
    expect(api.sidechatDispose).toHaveBeenCalledWith('late-child')
    expect(api.sidechatPrompt).not.toHaveBeenCalled()
  })

  it('binds a late child to the original tab after switching chats, without opening or sending in the new chat', async () => {
    let resolve!: (value: { childId: string }) => void
    vi.mocked(api.sidechatStart).mockImplementation(() => new Promise(done => { resolve = done }))
    const { store, tab } = setup()
    await act(async () => { store.setSession('other'); resolve({ childId: 'late-child' }) })
    expect(store.getSnapshot().sessionId).toBe('other')
    expect(tab().meta).toMatchObject({ threadId: 'late-child', quoteDraft: expect.anything() })
    expect(api.sidechatDispose).not.toHaveBeenCalled()
    expect(api.sidechatPrompt).not.toHaveBeenCalled()
  })
})
