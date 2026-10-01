/**
 * Sidebar crash tests — the two failure modes behind issue #31.
 *
 * 1. Layout-push leak: the layout-push effect writes
 *    `--dsh-sidebar-width/--dsh-sidebar-height` on document.documentElement.
 *    Unmounting the Sidebar for ANY reason (error-boundary swap, plugin
 *    disable, HMR) must clear them — otherwise layout.css keeps squeezing
 *    `#root` with a stale margin and "the sidebar cannot be hidden" until a
 *    full page reload.
 *
 * 2. Tab crash containment: a render error inside ONE tab's content must not
 *    take down the whole sidebar. The per-tab boundary shows a strip inside
 *    that tab's pane while the toggle cluster, the other tabs, and the panel
 *    itself stay alive; the retry button recovers a transient crash.
 *
 * Rendered with the REAL Sidebar shell + real store/service against a minimal
 * fake context (createRoot + act(), the repo's jsdom pattern).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { allLeaves, createSidebarStore, setBottomHeight, toggleBottomPanel, type SidebarStore } from '../src/client/state.ts'
import { ACTIVITY_RAIL_WIDTH } from '../src/client/activity-rail.ts'
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'
import { t } from '../src/client/locales.ts'

/** jsdom has no WebSocket; the agent-terminals push effect constructs one on mount. */
class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = (): void => {}
  constructor(_url: string) {}
}

interface MountedSidebar {
  container: HTMLDivElement
  store: SidebarStore
  service: BetterSidebarService
  unmount: () => void
}

/** Mount the real Sidebar shell against a minimal context (real store + service). */
/** Unique per-test session ids (see the comment inside). */
let sessionSeq = 0

function mountSidebar(openByDefault = true): MountedSidebar {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  // Fresh-session seed: open the panel explicitly (openByDefault defaults off).
  store.setPrefs({ ...store.getPrefs(), openByDefault })
  // Unique session per test — the store persists per-session state to
  // localStorage (200ms debounce); a shared id lets a previous test's late
  // write leak into this store's setSession restore.
  const sessionId = `s1-${++sessionSeq}`
  store.setSession(sessionId)
  // useSyncExternalStore requires STABLE snapshots across calls (the real DSH
  // services return stable objects) — a fresh object per call loops forever.
  const localeSnapshot = { active: 'en' }
  const sessionsSnapshot = {
    current: sessionId,
    // cwd present → api.sessionCwd is never called in these tests.
    byId: { [sessionId]: { cwd: '/tmp' } },
  }
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
    betterSidebar: service,
    get: (name: string) => name === 'betterSidebar' ? service : undefined,
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as never, store })) })
  return {
    container,
    store,
    service,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  // Belt and braces: drop any persisted layout a pending 200ms debounce
  // write left behind between tests (unique session ids already isolate).
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('layout-push variable cleanup', () => {
  it('clears --dsh-sidebar-width/--dsh-sidebar-height when the sidebar unmounts', () => {
    const { store, unmount } = mountSidebar()
    const htmlStyle = document.documentElement.style
    // The seeded session is open: the layout push is applied on mount.
    const width = store.getSnapshot().state!.width
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-width')).toBe(`${width + ACTIVITY_RAIL_WIDTH}px`)
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-height')).toBe('0px')
    // Any unmount (boundary swap, plugin disable, HMR) must release the push.
    unmount()
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-width')).toBe('')
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-height')).toBe('')
  })

  it('a size change (release commit) re-applies the variables without removing them mid-commit', () => {
    const { store, unmount } = mountSidebar()
    const htmlStyle = document.documentElement.style
    const width = store.getSnapshot().state!.width
    const removeSpy = vi.spyOn(htmlStyle, 'removeProperty')
    // Simulate a drag release: the bottom panel opens and its height commits.
    act(() => { store.reduce(toggleBottomPanel) })
    act(() => { store.reduce(s => setBottomHeight(s, 300)) })
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-width')).toBe(`${width + ACTIVITY_RAIL_WIDTH}px`)
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-height')).toBe('300px')
    // The commit must NOT have removed the variables at any point. React
    // runs every effect cleanup before every effect setup in a commit, so a
    // cleanup here would remove the variables before the draggingRef effect
    // (declared above the layout push) forces a layout in measureCenter
    // (getBoundingClientRect). That forced recalc resolves #root's
    // margin-right to the 0px fallback, caches it as the transition start
    // value, and measures centerRect too wide; once transitions re-enable on
    // release, the shell animates margin-right 0 → width — the "expand to
    // the full page then bounce back" flash.
    const removalProps = removeSpy.mock.calls
      .map(call => call[0] as string)
      .filter(prop => prop === '--dsh-sidebar-width' || prop === '--dsh-sidebar-height')
    expect(removalProps).toHaveLength(0)
    // Only unmounting may remove them (issue #31).
    unmount()
    expect(removeSpy.mock.calls.some(call =>
      call[0] === '--dsh-sidebar-width' || call[0] === '--dsh-sidebar-height')).toBe(true)
    removeSpy.mockRestore()
  })
})

describe('tab crash containment', () => {
  it('a crashing tab shows an in-pane strip while the cluster and panel survive', () => {
    const { container, service, store } = mountSidebar()
    service.registerTab({
      id: 'crash',
      title: 'Crash',
      component: () => { throw new Error('boom') },
    })
    act(() => { service.openTab({ type: 'crash', title: 'Crash' }) })
    // The strip lives inside the tab's pane — the crash is contained.
    expect(container.textContent).toContain('boom')
    expect(container.textContent).toContain(t('terminalRetry'))
    // The toggle cluster and the panel itself survived (no full-tree swap):
    // the collapse button is still there and the layout push is still live.
    expect(container.querySelector(`[aria-label="${t('collapse')}"]`)).not.toBeNull()
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe(
      `${store.getSnapshot().state!.width + ACTIVITY_RAIL_WIDTH}px`,
    )
  })

  it('the retry button recovers a tab whose crash has since been fixed', () => {
    // A PERSISTENT render error reaches the boundary strip (React 18.2
    // auto-recovers transient throws — one bad render followed by a good
    // retry is swallowed as a recoverable error and never shows a strip).
    let shouldThrow = true
    const { container, service } = mountSidebar()
    service.registerTab({
      id: 'crash-until-fixed',
      title: 'Crash until fixed',
      component: () => {
        if (shouldThrow) throw new Error('transient')
        return createElement('div', null, 'recovered')
      },
    })
    act(() => { service.openTab({ type: 'crash-until-fixed', title: 'Crash until fixed' }) })
    expect(container.textContent).toContain('transient')
    const retry = [...container.querySelectorAll('button')]
      .find(button => button.textContent === t('terminalRetry'))
    expect(retry).toBeDefined()
    // The crash condition is gone (e.g. the data arrived): the retry button
    // remounts the tab's content and the strip clears.
    shouldThrow = false
    act(() => { retry!.click() })
    expect(container.textContent).toContain('recovered')
    expect(container.textContent).not.toContain('transient')
  })
})

describe('persistent activity rail', () => {
  it('shows the enabled registered options in order while the content panel is closed', () => {
    const { container, service, store, unmount } = mountSidebar(false)
    act(() => {
      for (let index = 8; index >= 0; index--) service.registerTab({
        id: `entry-${index}`, title: `Entry ${index}`, order: index, component: () => null,
      })
    })
    const buttons = [...container.querySelectorAll('[data-dsh-rail-option]')]
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(Array.from({ length: 9 }, (_, index) => `Entry ${index}`))
    expect(store.getSnapshot().state!.panelOpen).toBe(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('44px')
    act(() => { store.setPrefs({ ...store.getPrefs(), tabsEnabled: { 'entry-3': false } }) })
    expect(container.querySelector('[data-dsh-rail-option="entry-3"]')).toBeNull()
    unmount()
  })

  it('reuses an existing multi-instance page and fires activation callbacks without minting again', () => {
    const { container, service, store, unmount } = mountSidebar(false)
    let minted = 0
    const onOpen = vi.fn(), onActivate = vi.fn()
    act(() => { service.registerTab({ id: 'terminal', title: 'Terminal', component: () => null,
      createTab: () => ({ tab: { id: `terminal:${++minted}`, type: 'terminal', title: 'Terminal' } }), onOpen, onActivate }) })
    const button = container.querySelector<HTMLButtonElement>('[data-dsh-rail-option="terminal"]')!
    act(() => { button.click() })
    expect(store.getSnapshot().state!.panelOpen).toBe(true)
    act(() => { button.click() })
    expect(store.getSnapshot().state!.panelOpen).toBe(false)
    act(() => { button.click() })
    expect(store.getSnapshot().state!.panelOpen).toBe(true)
    expect(minted).toBe(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledTimes(2)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    unmount()
  })

  it('creates a new page on the right after the bottom workbench had focus', () => {
    const { container, service, store, unmount } = mountSidebar(false)
    act(() => {
      service.registerTab({ id: 'tool', title: 'Tool', component: () => null })
      store.reduce(s => ({ ...s, activePane: allLeaves(s.bottomSplits)[0]!.id, bottomOpen: true }))
    })
    act(() => { container.querySelector<HTMLButtonElement>('[data-dsh-rail-option="tool"]')!.click() })
    const state = store.getSnapshot().state!
    expect(allLeaves(state.splits).flatMap(leaf => leaf.tabs).some(tab => tab.type === 'tool')).toBe(true)
    expect(allLeaves(state.bottomSplits).flatMap(leaf => leaf.tabs).some(tab => tab.type === 'tool')).toBe(false)
    expect(state.panelOpen).toBe(true)
    unmount()
  })

  it('allows reuse at a creation limit but blocks creating an unavailable page', () => {
    const { container, service, unmount } = mountSidebar(false)
    const createTab = vi.fn(() => ({ tab: { id: 'limited:1', type: 'limited', title: 'Limited' } }))
    act(() => {
      service.registerTab({ id: 'limited', title: 'Limited', component: () => null, available: () => false, createTab })
    })
    expect(container.querySelector<HTMLButtonElement>('[data-dsh-rail-option="limited"]')!.disabled).toBe(true)
    act(() => { service.openTab({ type: 'limited' }) })
    const button = container.querySelector<HTMLButtonElement>('[data-dsh-rail-option="limited"]')!
    expect(button.disabled).toBe(false)
    act(() => { button.click() })
    expect(createTab).toHaveBeenCalledTimes(1)
    unmount()
  })
})
