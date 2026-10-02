// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Context, SidebarSlotRegisterOptions } from '../src/context-types.ts'
import { Sidebar } from '../src/client/Sidebar.tsx'
import {
  createHeaderControlPlacement, HeaderPanelControls, registerHeaderPanelControls,
} from '../src/client/header-panel-controls.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { t } from '../src/client/locales.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

class FakeWebSocket {
  onmessage = null
  onclose = null
  onerror = null
  close(): void {}
}

const resizeCallbacks = new Set<() => void>()
class FakeResizeObserver {
  constructor(private callback: () => void) { resizeCallbacks.add(callback) }
  observe(): void {}
  disconnect(): void { resizeCallbacks.delete(this.callback) }
}

const mountedRoots: Root[] = []
let sequence = 0

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  vi.stubGlobal('innerWidth', 1200)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const visibleHeaderControls = this.hasAttribute('data-dsh-header-panel-controls') && this.closest('[hidden]') === null
    return { x: 0, y: 14, top: 14, bottom: 42, left: 0, right: visibleHeaderControls ? 60 : 0,
      width: visibleHeaderControls ? 60 : 0, height: visibleHeaderControls ? 28 : 0, toJSON: () => ({}) }
  })
})

afterEach(() => {
  act(() => { for (const root of mountedRoots.splice(0)) root.unmount() })
  document.body.innerHTML = ''
  resizeCallbacks.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(narrow = false) {
  if (narrow) vi.stubGlobal('innerWidth', 600)
  const store = createSidebarStore()
  const sessionId = `header-controls-${++sequence}`
  store.setSession(sessionId)
  const placement = createHeaderControlPlacement()
  const localeSnapshot = { active: 'en' }
  let sessionsSnapshot = { current: sessionId, byId: { [sessionId]: { cwd: '/tmp', displayTitle: 'Test' } } }
  const sessionListeners = new Set<() => void>()
  let declarationCallback: (() => () => void) | undefined
  let registrationDispose: (() => void) | undefined
  let entry: { options: SidebarSlotRegisterOptions; component: unknown } | undefined
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: { list: {
      subscribe: (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } },
      getSnapshot: () => sessionsSnapshot,
    } },
    get: () => undefined,
    slots: {
      inject: (_key: string, callback: () => () => void) => {
        declarationCallback = callback
        return () => { registrationDispose?.(); declarationCallback = undefined }
      },
      register: (options: SidebarSlotRegisterOptions, component: unknown) => {
        entry = { options, component }
        return () => { entry = undefined }
      },
    },
  } as unknown as Context
  const service = createBetterSidebarService(store)
  Object.assign(ctx, { betterSidebar: service })
  const panelHost = document.createElement('div')
  const headerHost = document.createElement('header')
  document.body.append(panelHost, headerHost)
  const panelRoot = createRoot(panelHost)
  const headerRoot = createRoot(headerHost)
  mountedRoots.push(panelRoot, headerRoot)
  act(() => { panelRoot.render(createElement(Sidebar, { ctx, store, headerControls: placement })) })
  const unregister = registerHeaderPanelControls(ctx, store, placement)
  const showHeader = (id = sessionId): void => {
    if (entry === undefined) throw new Error('The native utility slot was not declared')
    act(() => { headerRoot.render(createElement(entry!.component as typeof HeaderPanelControls,
      { sessionId: id, ...entry!.options.inject!() } as never)) })
  }
  return {
    store, placement, headerHost, panelHost, unregister, showHeader,
    declare: () => { registrationDispose = declarationCallback?.() },
    entry: () => entry,
    hideHeader: () => { act(() => { headerRoot.render(null) }) },
    switchSession: (id: string) => {
      sessionsSnapshot = { current: id, byId: { [id]: { cwd: '/tmp', displayTitle: 'Other' } } }
      act(() => { for (const listener of sessionListeners) listener() })
    },
  }
}

function button(label: string, host: ParentNode = document): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label)
  if (found === undefined) throw new Error(`Missing button: ${label}`)
  return found
}

async function flushMeasurements(): Promise<void> {
  await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 10)) })
}

describe('native Session utility panel controls', () => {
  it('keeps working corner controls on older hosts until the public slot is declared', () => {
    const app = setup()
    expect(app.entry()).toBeUndefined()
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).not.toBeNull()
    act(() => { button(t('expand')).click() })
    expect(app.store.getSnapshot().state!.panelOpen).toBe(true)
    app.declare()
    expect(app.entry()!.options).toMatchObject({ name: 'conversation.session.header.utilities', order: 100 })
    app.showHeader()
    expect(app.placement.getSnapshot()).toBe(true)
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).toBeNull()
    expect(document.body.hasAttribute('data-dsh-sidebar-collapsed')).toBe(false)
    expect(document.querySelectorAll('button[aria-label="' + t('collapse') + '"]')).toHaveLength(1)
    const panelLayer = app.panelHost.querySelector<HTMLElement>('[data-dsh-panel-host]')!
    expect(panelLayer.style.getPropertyValue('--dsh-toggle-reserve-width')).toBe('0px')
  })

  it('toggles both real panel states from the header and restores fallback for blank headers', () => {
    const app = setup()
    app.declare()
    app.showHeader()
    act(() => { button(t('expand'), app.headerHost).click(); button(t('expandBottomPanel'), app.headerHost).click() })
    expect(app.store.getSnapshot().state).toMatchObject({ panelOpen: true, bottomOpen: true })
    app.hideHeader()
    expect(app.placement.getSnapshot()).toBe(false)
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).not.toBeNull()
    act(() => { button(t('collapse'), app.panelHost).click(); button(t('collapseBottomPanel'), app.panelHost).click() })
    expect(app.store.getSnapshot().state).toMatchObject({ panelOpen: false, bottomOpen: false })
    app.showHeader()
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).toBeNull()
  })

  it('returns ownership to the corner when the native header is hidden by navigation', () => {
    const app = setup()
    app.declare()
    app.showHeader()
    app.headerHost.hidden = true
    act(() => { for (const callback of [...resizeCallbacks]) callback() })
    expect(app.placement.getSnapshot()).toBe(false)
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).not.toBeNull()
    app.headerHost.hidden = false
    act(() => { for (const callback of [...resizeCallbacks]) callback() })
    expect(app.placement.getSnapshot()).toBe(true)
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).toBeNull()
  })

  it('restores the corner for overflowing controls and recovers on pane resize without a window resize', () => {
    const app = setup()
    const pane = document.createElement('section')
    pane.setAttribute('data-pane', 'conversation')
    document.body.append(pane)
    pane.append(app.headerHost)
    let availableRight = 45
    pane.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: availableRight, bottom: 600,
      width: availableRight, height: 600, toJSON: () => ({}) })
    app.declare()
    app.showHeader()
    expect(app.placement.getPresentSnapshot()).toBe(true)
    expect(app.placement.getSnapshot()).toBe(false)
    expect(app.placement.getCenterSnapshot()).toBe(28)
    expect(app.headerHost.querySelector<HTMLElement>('[data-dsh-header-panel-controls]')!.style.visibility).toBe('hidden')
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).not.toBeNull()
    const layer = app.panelHost.querySelector<HTMLElement>('[data-dsh-panel-host]')!
    expect(layer.style.getPropertyValue('--dsh-toggle-top')).toBe('14px')
    expect(layer.style.getPropertyValue('--dsh-toggle-tab-height')).toBe('45px')
    // No viewport resize: opening/closing the native left sidebar changes
    // the conversation pane while the fixed-size utility buttons stay 60px.
    availableRight = 100
    act(() => { for (const callback of [...resizeCallbacks]) callback() })
    expect(app.placement.getSnapshot()).toBe(true)
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).toBeNull()
    expect(layer.style.getPropertyValue('--dsh-toggle-tab-height')).toBe('34px')
    availableRight = 45
    act(() => { for (const callback of [...resizeCallbacks]) callback() })
    expect(app.placement.getSnapshot()).toBe(false)
    expect(document.body.hasAttribute('data-dsh-sidebar-collapsed')).toBe(false)
    act(() => { for (const callback of [...resizeCallbacks]) callback() })
    expect(app.placement.getSnapshot()).toBe(false)
  })

  it('uses the real parent column of a display:contents conversation slot as its boundary', () => {
    const app = setup()
    const column = document.createElement('div')
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'conversation')
    slot.style.display = 'contents'
    // Exactly the actual host structure: the slot has a zero rect, while
    // its parent owns the visible conversation column.
    column.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600,
      width: 1000, height: 600, toJSON: () => ({}) })
    document.body.append(column)
    column.append(slot)
    slot.append(app.headerHost)
    expect(slot.getBoundingClientRect().width).toBe(0)
    app.declare()
    app.showHeader()
    expect(app.placement.getSnapshot()).toBe(true)
    expect(app.placement.getCenterSnapshot()).toBe(28)
    expect(app.headerHost.querySelector<HTMLElement>('[data-dsh-header-panel-controls]')!.style.visibility).toBe('')
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).toBeNull()
  })

  it('reacts autonomously to visibility-only header changes and stops watching after unmount', async () => {
    const app = setup()
    app.declare()
    app.showHeader()
    const activeObservers = resizeCallbacks.size
    // visibility preserves dimensions and therefore never fires RO.
    app.headerHost.style.visibility = 'hidden'
    await flushMeasurements()
    expect(app.placement.getSnapshot()).toBe(false)
    expect(app.placement.getCenterSnapshot()).toBeUndefined()
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).not.toBeNull()
    app.headerHost.style.visibility = 'visible'
    await flushMeasurements()
    expect(app.placement.getSnapshot()).toBe(true)
    app.hideHeader()
    expect(resizeCallbacks.size).toBe(activeObservers - 1)
    app.headerHost.style.visibility = 'hidden'
    await flushMeasurements()
    expect(app.placement.getPresentSnapshot()).toBe(false)
    expect(app.placement.getSnapshot()).toBe(false)
    expect(app.placement.getCenterSnapshot()).toBeUndefined()
  })

  it('keeps a reachable corner close button while the narrow drawer covers the native header', () => {
    const app = setup(true)
    app.declare()
    app.showHeader()
    expect(app.headerHost.querySelectorAll('button')).toHaveLength(1)
    act(() => { button(t('expand'), app.headerHost).click() })
    expect(app.headerHost.querySelector('[data-dsh-header-panel-controls]')).toBeNull()
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')!.querySelectorAll('button')).toHaveLength(1)
    act(() => { button(t('collapse'), app.panelHost).click() })
    expect(app.placement.getSnapshot()).toBe(true)
    expect(app.panelHost.querySelector('[data-dsh-toggle-cluster]')).toBeNull()
    expect(app.store.getSnapshot().state!.bottomOpen).toBe(false)
  })

  it('does not let a retained stale Session header toggle the newly selected Session', () => {
    const app = setup()
    app.declare()
    app.showHeader()
    app.switchSession('different-session')
    expect(app.headerHost.querySelectorAll('button')).toHaveLength(0)
    expect(app.placement.getSnapshot()).toBe(false)
    expect(app.store.getSnapshot().sessionId).toBe('different-session')
    app.showHeader('different-session')
    expect(app.placement.getSnapshot()).toBe(true)
    act(() => { button(t('expand'), app.headerHost).click() })
    expect(app.store.getSnapshot().state!.panelOpen).toBe(true)
    app.unregister()
    expect(app.entry()).toBeUndefined()
  })

  it('does not let disposal of an old visible header erase a newer owner or emit duplicate changes', () => {
    const placement = createHeaderControlPlacement()
    const listener = vi.fn()
    placement.subscribe(listener)
    const older = placement.claim()
    const newer = placement.claim()
    older.setVisible(true)
    newer.setVisible(true)
    older.dispose()
    expect(placement.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(2)
    older.setVisible(true)
    newer.setVisible(false)
    newer.setVisible(false)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(placement.getSnapshot()).toBe(false)
  })
})
