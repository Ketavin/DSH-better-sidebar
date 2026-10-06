// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { TaskViews } from '../src/client/TaskViews.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'
import type { TaskViewProps } from '../src/client/service.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('Tasks child views', () => {
  it('has an isolated registry, stable ordering, validation and idempotent disposers', () => {
    const service = createBetterSidebarService(createSidebarStore())
    const changed = vi.fn()
    const rail = vi.fn()
    service.subscribe(rail)
    const unsubscribe = service.subscribeTaskViews(changed)
    expect(() => service.registerTaskView({ id: 'tasks', title: 'Reserved', component: () => null })).toThrow()
    const old = service.registerTaskView({ id: 'flow', title: 'Flow', order: 20, component: () => null })
    expect(() => service.registerTaskView({ id: 'flow', title: 'Duplicate', component: () => null })).toThrow()
    service.registerTaskView({ id: 'first', title: 'First', order: 10, component: () => null })
    expect(service.getTaskViews().map(view => view.id)).toEqual(['first', 'flow'])
    old()
    const fresh = service.registerTaskView({ id: 'flow', title: 'New', component: () => null })
    old()
    expect(service.getTaskViews()[1]?.title).toBe('New')
    expect(service.getTaskViewRevision()).toBe(4)
    expect(changed).toHaveBeenCalledTimes(4)
    expect(rail).not.toHaveBeenCalled()
    expect(service.getTabs()).toEqual([])
    unsubscribe()
    fresh()
    expect(changed).toHaveBeenCalledTimes(4)
    expect(service.features).toContain('taskViews')
  })

  it('defaults to native, pauses inactive views and resets on scope change or uninstall', () => {
    const service = createBetterSidebarService(createSidebarStore())
    const container = document.createElement('div')
    const root = createRoot(container)
    const mount = vi.fn()
    const cleanup = vi.fn()
    const component = (props: TaskViewProps) => {
      useEffect(() => { mount(); return cleanup }, [])
      return createElement('p', { 'data-flow': props.scope.sessionId }, 'Flow')
    }
    let dispose = service.registerTaskView({ id: 'flow', title: 'Flow', component })
    const render = (sessionId = 'a', visible = true) => act(() => root.render(createElement(TaskViews, {
      service, ctx: {} as Context, scope: { sessionId }, visible,
      renderTasks: active => createElement('p', { 'data-native-active': String(active) }, 'Native'),
    })))
    const open = () => act(() => (container.querySelectorAll('button')[1] as HTMLButtonElement).click())
    render()
    expect(container.querySelector('[data-native-active=true]')).not.toBeNull()
    open()
    expect(container.querySelector('[data-flow=a]')).not.toBeNull()
    expect(container.querySelector('[data-native-active=false]')).not.toBeNull()
    render('a', false)
    expect(cleanup).toHaveBeenCalledTimes(1)
    render()
    expect(mount).toHaveBeenCalledTimes(2)
    render('b')
    expect(container.querySelector('[data-flow]')).toBeNull()
    open()
    expect(container.querySelector('[data-flow=b]')).not.toBeNull()
    act(dispose)
    expect(container.querySelector('[data-flow]')).toBeNull()
    expect(container.querySelector('[data-native-active=true]')).not.toBeNull()
    act(() => { dispose = service.registerTaskView({ id: 'flow', title: 'Flow', component }) })
    expect(container.querySelector('[data-flow]')).toBeNull()
    act(() => root.unmount())
    dispose()
    expect(cleanup).toHaveBeenCalledTimes(3)
  })

  it('contains a crashed plugin and keeps keyboard return to native Tasks available', () => {
    const service = createBetterSidebarService(createSidebarStore())
    service.registerTaskView({ id: 'broken', title: 'Broken', component: () => { throw new Error('controlled failure') } })
    const container = document.createElement('div')
    const root = createRoot(container)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => root.render(createElement(TaskViews, {
      service, ctx: {} as Context, scope: { sessionId: 'a' }, visible: true, renderTasks: () => 'Native',
    })))
    act(() => (container.querySelectorAll('button')[1] as HTMLButtonElement).click())
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    act(() => container.querySelectorAll('button')[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(container.querySelector('[role=alert]')).toBeNull()
    expect(container.querySelector('[aria-selected=true]')?.textContent).not.toBe('Broken')
    act(() => root.unmount())
    logged.mockRestore()
  })
})
