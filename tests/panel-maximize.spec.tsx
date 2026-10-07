// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { Sidebar } from '../src/client/Sidebar.tsx'
import { createSidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { attachLocale } from '../src/client/locales.ts'
import { togglePanel, toggleBottomPanel } from '../src/client/state.ts'
import type { TabComponentProps } from '../src/client/service.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); attachLocale(undefined); localStorage.clear(); vi.unstubAllGlobals() })
function mount() {
  vi.stubGlobal('WebSocket', class { close() {} })
  const container = document.createElement('div'); document.body.append(container)
  const store = createSidebarStore(); store.setPrefs({ ...store.getPrefs(), openByDefault: true }); store.setSession('max-test')
  const service = createBetterSidebarService(store), mounted = vi.fn(), unmounted = vi.fn()
  function Browser(props: TabComponentProps) { useEffect(() => { mounted(); return unmounted }, []); return createElement('input', {
    'aria-label': 'browser-draft', defaultValue: 'retained', 'data-focused': props.contentFocus,
  }) }
  service.registerTab({ id: 'editor', title: 'Files', component: () => null })
  service.registerTab({ id: 'max-browser', title: 'Browser', component: Browser })
  service.openTab({ type: 'max-browser' })
  const localeState = { active: 'en' }, locale = { subscribe: () => () => {}, getSnapshot: () => localeState }
  attachLocale(locale)
  const sessions = { current: 'max-test', byId: { 'max-test': { cwd: '/tmp' } } }
  const ctx = { locale, sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessions } },
    get: (name: string) => name === 'betterSidebar' ? service : undefined }
  const root = createRoot(container)
  act(() => root.render(createElement(Sidebar, { ctx: ctx as never, store })))
  cleanups.push(() => { act(() => root.unmount()); container.remove() })
  const toggle = () => act(() => container.querySelector<HTMLButtonElement>('[data-dsh-maximize="right"]')!.click())
  return { container, store, service, mounted, unmounted, toggle }
}
describe('full content inside the existing panel', () => {
  it('collapses controls without changing geometry, remounting a tab or losing its input', () => {
    const f = mount(), original = f.store.getSnapshot().state!.width
    const input = f.container.querySelector<HTMLInputElement>('[aria-label="browser-draft"]')!
    input.value = 'unsent edit'; const before = f.mounted.mock.calls.length
    f.toggle()
    expect(f.container.querySelector('[data-dsh-panel-host]')!.getAttribute('data-dsh-focused-panel')).toBe('right')
    const panel = f.container.querySelector<HTMLElement>('[data-dsh-maximizable="right"]')!
    expect(panel.style.width).toBe(`${original}px`)
    expect(panel.hasAttribute('data-dsh-content-focused')).toBe(true)
    expect(input.getAttribute('data-focused')).toBe('true')
    expect(panel.style.right).toBe(''); expect(panel.style.zIndex).toBe('')
    expect(f.container.querySelector('[data-dsh-sidebar-rail]')).not.toBeNull()
    expect(f.store.getSnapshot().state!.width).toBe(original)
    expect(f.container.querySelector('[aria-label="browser-draft"]')).toBe(input)
    expect(input.value).toBe('unsent edit'); expect(f.mounted).toHaveBeenCalledTimes(before); expect(f.unmounted).not.toHaveBeenCalled()
    f.toggle(); expect(panel.style.width).toBe(`${original}px`)
    expect(f.container.querySelector('[data-dsh-panel-host]')!.hasAttribute('data-dsh-focused-panel')).toBe(false)
    expect(input.getAttribute('data-focused')).toBe('false')
  })
  it('leaves Escape to editors and IME, while Escape outside inputs restores the panel', () => {
    const f = mount(); f.toggle()
    const input = f.container.querySelector('input')!
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })))
    expect(f.container.querySelector('[data-dsh-content-focused]')).not.toBeNull()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true })))
    expect(f.container.querySelector('[data-dsh-content-focused]')).not.toBeNull()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })))
    expect(f.container.querySelector('[data-dsh-content-focused]')).toBeNull()
  })
  it('exits maximization on close, so reopening restores the saved size', () => {
    const f = mount(); f.toggle()
    act(() => f.store.reduce(togglePanel))
    act(() => f.store.reduce(togglePanel))
    expect(f.container.querySelector('[data-dsh-content-focused]')).toBeNull()
    expect(f.container.querySelector<HTMLElement>('[data-dsh-maximizable="right"]')!.style.width).toBe(`${f.store.getSnapshot().state!.width}px`)
  })
  it('shows controls on an active-tab or session change', () => {
    const f = mount(); f.toggle()
    act(() => f.service.openTab({ type: 'editor' }))
    expect(f.container.querySelector('[data-dsh-content-focused]')).toBeNull()
    f.toggle()
    act(() => f.store.setSession('another-session'))
    expect(f.container.querySelector('[data-dsh-content-focused]')).toBeNull()
  })
  it('keeps the bottom panel at its saved height and position too', () => {
    const f = mount()
    act(() => f.store.reduce(toggleBottomPanel))
    const panel = f.container.querySelector<HTMLElement>('[data-dsh-maximizable="bottom"]')!
    const before = { height: panel.style.height, left: panel.style.left, right: panel.style.right }
    act(() => f.container.querySelector<HTMLButtonElement>('[data-dsh-maximize="bottom"]')!.click())
    expect(panel.hasAttribute('data-dsh-content-focused')).toBe(true)
    expect({ height: panel.style.height, left: panel.style.left, right: panel.style.right }).toEqual(before)
    expect(panel.style.zIndex).toBe('')
  })
})
