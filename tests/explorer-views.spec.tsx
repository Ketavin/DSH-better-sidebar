// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ExplorerViews } from '../src/client/ExplorerViews.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('explorer extension lifecycle', () => {
  it('notifies only explorer subscribers and makes stale disposers harmless', () => {
    const service = createBetterSidebarService(createSidebarStore())
    const explorerChanged = vi.fn()
    const viewersChanged = vi.fn()
    const off = service.subscribeExplorerViews(explorerChanged)
    service.subscribeFileViewers(viewersChanged)
    const old = service.registerExplorerView({ id: 'deliveries', title: 'Deliveries', component: () => null })
    expect(service.getExplorerViewRevision()).toBe(1)
    expect(() => service.registerExplorerView({ id: 'deliveries', title: 'Duplicate', component: () => null })).toThrow()
    old()
    const fresh = service.registerExplorerView({ id: 'deliveries', title: 'New', component: () => null })
    old()
    expect(service.getExplorerViews()[0]?.title).toBe('New')
    expect(explorerChanged).toHaveBeenCalledTimes(3)
    expect(viewersChanged).not.toHaveBeenCalled()
    off()
    fresh()
    expect(explorerChanged).toHaveBeenCalledTimes(3)
    expect(service.features).toContain('explorerViews')
  })

  it('keeps the workspace input mounted during selection and recovers on plugin removal', () => {
    const service = createBetterSidebarService(createSidebarStore())
    const container = document.createElement('div')
    const root = createRoot(container)
    const view = vi.fn(() => createElement('p', { 'data-custom': true }, 'Actual deliveries'))
    let dispose = () => {}
    act(() => { dispose = service.registerExplorerView({ id: 'deliveries', title: 'Deliveries', component: view }) })
    act(() => root.render(createElement(ExplorerViews, {
      service, ctx: {} as Context, scope: { sessionId: 'session-a' }, visible: true, onOpenFile: vi.fn(),
      children: createElement('input', { 'data-native': true, defaultValue: 'upload still active' }),
    })))
    const input = container.querySelector('input')!
    input.value = 'retained draft'
    act(() => (container.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(container.querySelector('[data-custom]')).not.toBeNull()
    expect(input.closest('[hidden]')).not.toBeNull()
    act(() => (container.querySelector('button') as HTMLButtonElement).click())
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('retained draft')
    act(() => (container.querySelectorAll('button')[1] as HTMLButtonElement).click())
    act(dispose)
    expect(container.querySelector('[data-custom]')).toBeNull()
    expect(container.querySelector('input')).toBe(input)
    expect(input.value).toBe('retained draft')
    act(() => root.unmount())
  })

  it('contains an extension failure and leaves the workspace switch usable', () => {
    const service = createBetterSidebarService(createSidebarStore())
    service.registerExplorerView({ id: 'broken', title: 'Broken', component: () => { throw new Error('plugin failed') } })
    const container = document.createElement('div')
    const root = createRoot(container)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => root.render(createElement(ExplorerViews, {
      service, ctx: {} as Context, scope: { sessionId: 'session-a' }, visible: true, onOpenFile: vi.fn(), children: 'Workspace files',
    })))
    act(() => (container.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    act(() => (container.querySelector('button') as HTMLButtonElement).click())
    expect(container.textContent).toContain('Workspace files')
    expect(container.querySelector('[role=alert]')).toBeNull()
    act(() => root.unmount())
    consoleError.mockRestore()
  })
})
