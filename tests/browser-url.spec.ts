import { describe, expect, it, vi } from 'vitest'
import { createBetterSidebarService, type BrowserUrlRequest } from '../src/client/service.ts'
import { allLeaves, createSidebarStore } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'

const globals = globalThis as Record<string, unknown>
globals.window ??= { clearTimeout: () => {}, setTimeout: () => 0, innerWidth: 1024 }
globals.localStorage ??= { getItem: () => null, setItem: () => {} }

function fixture() {
  const store = createSidebarStore()
  store.setSession('session-a')
  const service = createBetterSidebarService(store, {} as Context)
  service.registerTab({
    id: 'browser', title: 'Browser', component: () => null,
    createTab: state => ({ tab: { id: `browser:${state.nextBrowser}`, type: 'browser', title: 'Browser' }, patch: { nextBrowser: state.nextBrowser + 1 } }),
  })
  return { store, service }
}
const request = (extra: Partial<BrowserUrlRequest> = {}): BrowserUrlRequest => ({
  url: 'https://example.com/path', scope: { sessionId: 'session-a', cwd: 'E:/sandbox/a' },
  source: 'plugin', requestId: 'request-1', ...extra,
})
const tabsOf = (store: ReturnType<typeof createSidebarStore>, sessionId = 'session-a') =>
  allLeaves(store.getSessionStates().get(sessionId)!.splits).flatMap(leaf => leaf.tabs)

describe('public browser URL contract', () => {
  it('preserves per-URL preview tabs and advertises the additive capability', async () => {
    const { store, service } = fixture()
    expect(service.features).toContain('browserUrl')
    expect(await service.openBrowserUrl(request())).toEqual({ ok: true, type: 'browser', url: 'https://example.com/path' })
    await service.openBrowserUrl(request({ url: 'https://example.com/second', requestId: 'request-2' }))
    expect(tabsOf(store).filter(tab => tab.type === 'browser').map(tab => tab.path)).toEqual(['https://example.com/path', 'https://example.com/second'])
  })

  it('preserves an explicit Agent open title on the ordinary preview tab', async () => {
    const { store, service } = fixture()
    await service.openBrowserUrl(request({ title: 'Reference page', source: 'sidebar_open' }))
    expect(tabsOf(store).find(tab => tab.type === 'browser')?.title).toBe('Reference page')
  })

  it('keeps enabled specialized URL claims unless preview was chosen explicitly', async () => {
    const { store, service } = fixture()
    service.registerTab({ id: 'docs:viewer', title: 'Docs', component: () => null, urlTarget: url => url.hostname === 'example.com' })
    expect((await service.openBrowserUrl(request())).ok).toBe(true)
    expect(tabsOf(store).some(tab => tab.type === 'docs:viewer' && tab.path === 'https://example.com/path')).toBe(true)
    expect(await service.openBrowserUrl(request({ mode: 'preview' }))).toMatchObject({ ok: true, type: 'browser' })
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { 'docs:viewer': false } })
    expect(await service.openBrowserUrl(request())).toMatchObject({ ok: true, type: 'browser' })
  })

  it('does not pretend a registered observer can navigate without an adapter', async () => {
    const { store, service } = fixture()
    expect(await service.openBrowserUrl(request({ mode: 'agent' }))).toMatchObject({ ok: false, code: 'unavailable' })
    service.registerTab({ id: 'ego-browser:watch', title: 'Agent Browser', component: () => null })
    expect(await service.openBrowserUrl(request({ mode: 'agent' }))).toMatchObject({ ok: false, code: 'handler-unavailable' })
    expect(tabsOf(store).some(tab => tab.type === 'ego-browser:watch')).toBe(false)
    expect(tabsOf(store).some(tab => tab.type === 'browser')).toBe(false)
  })

  it('passes an immutable session scope to the adapter and waits before opening the true type', async () => {
    const { store, service } = fixture()
    let finish!: () => void
    const navigate = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    service.registerTab({ id: 'ego-browser:watch', title: 'Agent Browser', component: () => null, onOpenUrl: navigate })
    const input = request({ mode: 'agent', scope: { sessionId: 'session-b', cwd: 'E:/sandbox/b' } })
    const pending = service.openBrowserUrl(input)
    expect(navigate).toHaveBeenCalledWith({ ...input, scope: { sessionId: 'session-b', cwd: 'E:/sandbox/b' } })
    input.scope.sessionId = 'session-a'
    expect(tabsOf(store).some(tab => tab.type === 'ego-browser:watch')).toBe(false)
    store.setSession('session-c')
    finish()
    expect(await pending).toMatchObject({ ok: true, type: 'ego-browser:watch' })
    expect(store.getSnapshot().sessionId).toBe('session-c')
    expect(tabsOf(store, 'session-b').some(tab => tab.type === 'ego-browser:watch')).toBe(true)
  })

  it('refuses a disposed/re-registered adapter even if it reused the same descriptor object', async () => {
    const { store, service } = fixture()
    let finish!: () => void
    const descriptor = { id: 'ego-browser:watch', title: 'Agent Browser', component: () => null, onOpenUrl: () => new Promise<void>(resolve => { finish = resolve }) }
    const dispose = service.registerTab(descriptor)
    const pending = service.openBrowserUrl(request({ mode: 'agent' }))
    dispose()
    service.registerTab(descriptor)
    finish()
    expect(await pending).toMatchObject({ ok: false, code: 'stale-registration' })
    expect(tabsOf(store).some(tab => tab.type === 'ego-browser:watch')).toBe(false)
  })

  it('returns failure without preview fallback or leaking adapter exception text', async () => {
    const { store, service } = fixture()
    service.registerTab({ id: 'ego-browser:watch', title: 'Agent Browser', component: () => null, onOpenUrl: async () => { throw new Error('secret-url-value') } })
    const result = await service.openBrowserUrl(request({ mode: 'agent' }))
    expect(result).toMatchObject({ ok: false, code: 'handler-failed' })
    expect(JSON.stringify(result)).not.toContain('secret-url-value')
    expect(tabsOf(store).some(tab => ['browser', 'ego-browser:watch'].includes(tab.type))).toBe(false)
  })

  it('gates unavailable navigation and revokes a disabled mode while the adapter is pending', async () => {
    const { store, service } = fixture()
    let finish!: () => void
    const navigate = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    let available = false
    service.registerTab({ id: 'ego-browser:watch', title: 'Agent Browser', component: () => null, available: () => available, onOpenUrl: navigate })
    expect(await service.openBrowserUrl(request({ mode: 'agent' }))).toMatchObject({ ok: false, code: 'unavailable' })
    expect(navigate).not.toHaveBeenCalled()
    available = true
    const pending = service.openBrowserUrl(request({ mode: 'agent' }))
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { 'ego-browser:watch': false } })
    finish()
    expect(await pending).toMatchObject({ ok: false, code: 'disabled' })
    expect(tabsOf(store).some(tab => tab.type === 'ego-browser:watch')).toBe(false)
  })

  it('rejects invalid schemes, embedded credentials and missing scope before any tab mutation', async () => {
    const { store, service } = fixture()
    const snapshot = store.getSnapshot()
    for (const url of ['javascript:alert(1)', 'file:///E:/private', 'not a URL', 'https://user:password@example.com/']) {
      expect(await service.openBrowserUrl(request({ url }))).toMatchObject({ ok: false, code: 'invalid-url' })
    }
    expect(await service.openBrowserUrl(request({ scope: { sessionId: '' } }))).toMatchObject({ ok: false, code: 'missing-session' })
    expect(store.getSnapshot()).toBe(snapshot)
  })

  it('does not report success when a specialized tab refuses creation', async () => {
    const { service } = fixture()
    service.registerTab({ id: 'refusing:viewer', title: 'Full', component: () => null, urlTarget: () => true, createTab: () => null })
    expect(await service.openBrowserUrl(request())).toMatchObject({ ok: false, code: 'unavailable' })
  })
})
