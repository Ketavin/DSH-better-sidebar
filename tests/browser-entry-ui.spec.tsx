// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Sidebar } from '../src/client/Sidebar.tsx'
import { allLeaves, createSidebarStore, floatTab, openTabInActivePane, type SidebarState, type SidebarTab } from '../src/client/state.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { attachLocale, t } from '../src/client/locales.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_url: string) {}
  close(): void {}
}

const cleanups: Array<() => void> = []
let sessionSeq = 0
function mountSidebar() {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  store.setPrefs({ ...store.getPrefs(), openByDefault: false })
  const sessionId = `browser-entry-ui-${++sessionSeq}`
  store.setSession(sessionId)
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'editor', title: 'Files', component: () => null })
  const localeSnapshot = { active: 'en' }
  const locale = { subscribe: () => () => {}, getSnapshot: () => localeSnapshot }
  attachLocale(locale)
  const sessionsSnapshot = { current: sessionId, byId: { [sessionId]: { cwd: '/tmp' } } }
  const ctx = {
    locale,
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
    betterSidebar: service,
    get: (name: string) => name === 'betterSidebar' ? service : undefined,
  }
  const root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as never, store })) })
  cleanups.push(() => { act(() => { root.unmount() }); container.remove() })
  return { container, store, service, sessionId }
}

function rail(container: HTMLElement, type = 'browser'): HTMLButtonElement | null {
  return container.querySelector(`[data-dsh-rail-option="${type}"]`)
}
function realTabs(state: SidebarState | undefined): SidebarTab[] {
  if (state === undefined) return []
  return [...allLeaves(state.splits), ...allLeaves(state.bottomSplits)].flatMap(leaf => leaf.tabs)
    .concat(state.floats.map(float => float.tab))
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  attachLocale(undefined)
  localStorage.clear()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('real Sidebar Browser entry handlers', () => {
  it('keeps nine rail entries after an actual Ego descriptor registers, without inventing a mode before it', () => {
    const { container, service } = mountSidebar()
    act(() => {
      for (const id of ['git', 'subagent', 'sidechat', 'terminal', 'ssh', 'docs', 'other']) {
        service.registerTab({ id, title: id, component: () => null })
      }
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null })
    })
    expect(container.querySelectorAll('[data-dsh-rail-option]')).toHaveLength(9)
    expect(container.querySelector('[data-dsh-browser-mode="ego-browser:watch"]')).toBeNull()
    act(() => { service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null }) })
    expect(container.querySelectorAll('[data-dsh-rail-option]')).toHaveLength(9)
    expect(rail(container, 'ego-browser:watch')).toBeNull()
    expect(rail(container)).not.toBeNull()
  })

  it('preserves the mounted Preview component when an Agent descriptor registers and disposes', () => {
    const { container, service, store } = mountSidebar()
    const mounted = vi.fn(), unmounted = vi.fn()
    const Preview = () => {
      useEffect(() => { mounted(); return () => { unmounted() } }, [])
      return createElement('div', { 'data-preview-instance': true }, 'Preview instance')
    }
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: Preview })
      store.reduce(s => ({ ...openTabInActivePane(s, { id: 'preview', type: 'browser', title: 'Preview' }), panelOpen: true }))
    })
    const instance = container.querySelector('[data-preview-instance]')
    expect(mounted).toHaveBeenCalledTimes(1)
    let disposeAgent = () => {}
    act(() => { disposeAgent = service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null }) })
    expect(container.querySelector('[data-dsh-browser-mode="ego-browser:watch"]')).not.toBeNull()
    expect(container.querySelector('[data-preview-instance]')).toBe(instance)
    act(() => { disposeAgent() })
    expect(container.querySelector('[data-dsh-browser-mode="ego-browser:watch"]')).toBeNull()
    expect(container.querySelector('[data-preview-instance]')).toBe(instance)
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
  })

  it('activates the existing bottom Agent when every mode forbids creation, then switches to the real Preview', () => {
    const { container, service, store, sessionId } = mountSidebar()
    const onPreviewActivate = vi.fn(), onAgentActivate = vi.fn(), createPreview = vi.fn(), createAgent = vi.fn()
    const preview: SidebarTab = { id: 'preview-1', type: 'browser', title: 'Preview', path: 'https://example.org', meta: { keep: 'preview-state' } }
    const ego: SidebarTab = { id: 'ego-1', type: 'ego-browser:watch', title: 'Agent', meta: { space: 'own-agent-space' } }
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null,
        available: () => false, createTab: createPreview, onActivate: onPreviewActivate })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null,
        available: () => false, createTab: createAgent, onActivate: onAgentActivate })
      store.reduce(s => openTabInActivePane(s, preview))
      store.reduce(s => openTabInActivePane({ ...s, activePane: allLeaves(s.bottomSplits)[0]!.id }, ego))
    })
    const button = rail(container)!
    expect(button.disabled).toBe(false)
    act(() => { button.click() })
    expect(onAgentActivate).toHaveBeenCalledWith(ego, { sessionId, cwd: '/tmp' })
    expect(store.getSnapshot().state!.bottomOpen).toBe(true)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    const previewMode = container.querySelector<HTMLButtonElement>('[data-dsh-browser-mode="browser"]')!
    expect(previewMode.disabled).toBe(false)
    act(() => { previewMode.click() })
    expect(onPreviewActivate).toHaveBeenCalledWith(preview, { sessionId, cwd: '/tmp' })
    expect(store.getSnapshot().state!.panelOpen).toBe(true)
    expect(realTabs(store.getSnapshot().state).filter(tab => tab.type === 'browser' || tab.type === 'ego-browser:watch')).toEqual([preview, ego])
    expect(createPreview).not.toHaveBeenCalled()
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('blocks unavailable new modes but keeps an existing Preview activatable', () => {
    const { container, service, store } = mountSidebar()
    const createAgent = vi.fn(), onActivate = vi.fn()
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null, available: () => false, onActivate })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null, available: () => false, createTab: createAgent })
    })
    expect(rail(container)!.disabled).toBe(true)
    act(() => { store.reduce(s => openTabInActivePane(s, { id: 'preview', type: 'browser', title: 'Preview' })) })
    act(() => { rail(container)!.click() })
    expect(onActivate).toHaveBeenCalledTimes(1)
    const agentMode = container.querySelector<HTMLButtonElement>('[data-dsh-browser-mode="ego-browser:watch"]')!
    expect(agentMode.disabled).toBe(true)
    act(() => { agentMode.click() })
    expect(createAgent).not.toHaveBeenCalled()
  })

  it('uses a single + menu submenu whose children open their real tab type', () => {
    const { container, service, store } = mountSidebar()
    const onOpen = vi.fn()
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', single: true, component: () => null, onOpen })
      store.reduce(s => ({ ...s, panelOpen: true }))
    })
    const plus = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === t('newTab'))!
    act(() => { plus.click() })
    const browserRow = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(row => row.textContent === t('browser'))!
    act(() => { browserRow.click() })
    const agentRow = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(row => row.textContent === t('browserModeAgent'))!
    expect(agentRow).toBeDefined()
    act(() => { agentRow.click() })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(realTabs(store.getSnapshot().state).some(tab => tab.type === 'ego-browser:watch')).toBe(true)
    expect(realTabs(store.getSnapshot().state).some(tab => tab.type === 'browser')).toBe(false)
  })

  it.each(['browser', 'ego-browser:watch'])('rechecks %s availability after the + menu opened without falling back', (mode) => {
    const { container, service, store } = mountSidebar()
    const onOpen = vi.fn(), createTab = vi.fn()
    let available = true
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null,
        available: () => mode !== 'browser' || available, onOpen, createTab })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null,
        available: () => mode !== 'ego-browser:watch' || available, onOpen, createTab })
      store.reduce(s => ({ ...s, panelOpen: true }))
    })
    const plus = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === t('newTab'))!
    act(() => { plus.click() })
    const browserRow = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(row => row.textContent === t('browser'))!
    act(() => { browserRow.click() })
    const modeRow = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(row => row.textContent === t(mode === 'browser' ? 'browserModePreview' : 'browserModeAgent'))!
    available = false
    act(() => { modeRow.click() })
    expect(createTab).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    expect(realTabs(store.getSnapshot().state).some(tab => tab.type === 'browser' || tab.type === 'ego-browser:watch')).toBe(false)
  })

  it('lets the one Browser welcome card create the usable actual mode when Preview is unavailable', () => {
    const { container, service, store } = mountSidebar()
    const onOpen = vi.fn(), createPreview = vi.fn()
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null, available: () => false, createTab: createPreview })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null, onOpen })
      store.reduce(s => ({ ...s, panelOpen: true, activePane: 'empty-browser',
        splits: { kind: 'leaf', id: 'empty-browser', tabs: [], active: null } }))
    })
    const browserCards = (pane: Element) => [...pane.querySelectorAll<HTMLButtonElement>('button')]
      .filter(button => button.title === t('browser'))
    for (const pane of container.querySelectorAll('[data-dsh-pane]')) {
      expect(browserCards(pane)).toHaveLength(1)
    }
    const cards = browserCards(container.querySelector('[data-dsh-pane="empty-browser"]')!)
    expect(cards[0]!.disabled).toBe(false)
    act(() => { cards[0]!.click() })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(createPreview).not.toHaveBeenCalled()
    expect(realTabs(store.getSnapshot().state).some(tab => tab.type === 'ego-browser:watch')).toBe(true)
    expect(realTabs(store.getSnapshot().state).some(tab => tab.type === 'browser')).toBe(false)
  })

  it('drops a disabled Agent mode from the family without taking over its stored tab', () => {
    const { container, service, store } = mountSidebar()
    const onAgentActivate = vi.fn(), onPreviewActivate = vi.fn()
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null, onActivate: onPreviewActivate })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null, onActivate: onAgentActivate })
      store.reduce(s => openTabInActivePane(s, { id: 'preview', type: 'browser', title: 'Preview' }))
      store.reduce(s => openTabInActivePane(s, { id: 'ego', type: 'ego-browser:watch', title: 'Agent' }))
      store.setPrefs({ ...store.getPrefs(), tabsEnabled: { 'ego-browser:watch': false } })
    })
    act(() => { rail(container)!.click() })
    expect(onPreviewActivate).toHaveBeenCalledTimes(1)
    expect(onAgentActivate).not.toHaveBeenCalled()
    expect(container.querySelector('[data-dsh-browser-mode="ego-browser:watch"]')).toBeNull()
    expect(realTabs(store.getSnapshot().state).find(tab => tab.id === 'ego')?.type).toBe('ego-browser:watch')
  })

  it('recognizes a focused float while panels are closed and yields focus back to the pane', () => {
    const { container, service, store } = mountSidebar()
    act(() => {
      service.registerTab({ id: 'browser', title: 'Browser', component: () => null })
      service.registerTab({ id: 'ego-browser:watch', title: 'Ego', component: () => null })
      store.reduce(s => openTabInActivePane(s, { id: 'ego', type: 'ego-browser:watch', title: 'Agent' }))
      store.reduce(s => ({ ...floatTab(s, 'ego', 100, 100), panelOpen: false, bottomOpen: false }))
    })
    expect(rail(container)!.getAttribute('aria-pressed')).toBe('true')
    const window = container.querySelector<HTMLElement>('[data-dsh-float-window]')!
    act(() => { window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(rail(container)!.getAttribute('aria-pressed')).toBe('true')
    act(() => { store.reduce(s => ({ ...s, panelOpen: true })) })
    const pane = container.querySelector<HTMLElement>('[data-dsh-pane]')!
    act(() => { pane.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(rail(container)!.getAttribute('aria-pressed')).toBe('false')
    expect(store.getSnapshot().state!.floats[0]!.tab.type).toBe('ego-browser:watch')
  })
})
