import { describe, expect, it } from 'vitest'
import { createSidebarStore, allLeaves, openTabInActivePane, type SidebarState } from '../src/client/state.ts'
import { railPushWidth, railTarget } from '../src/client/activity-rail.ts'

const state = (): SidebarState => {
  const store = createSidebarStore()
  store.setSession('rail-target-test')
  return store.getSnapshot().state!
}

describe('rail targets', () => {
  it('the Files entry selects the explorer rather than an already opened report', () => {
    const input = openTabInActivePane(state(), { id: 'report', type: 'editor', title: 'Report', path: '/report.docx' })
    const home = allLeaves(input.splits).flatMap(leaf => leaf.tabs).find(tab => tab.type === 'editor' && tab.path === undefined)!
    expect(railTarget(input, 'editor')).toEqual({ tabId: home.id, placement: 'top' })
  })

  it('the Terminal entry never takes over an agent-owned terminal', () => {
    const input = openTabInActivePane(state(), { id: 'agent:job-1', type: 'terminal', title: 'Agent task' })
    expect(railTarget(input, 'terminal')).toBeUndefined()
  })

  it('finds a parked page in the bottom panel without creating a duplicate', () => {
    const input = state()
    const parked = openTabInActivePane({ ...input, activePane: allLeaves(input.bottomSplits)[0]!.id }, { id: 'browser:1', type: 'browser', title: 'Browser' })
    expect(railTarget(parked, 'browser')).toEqual({ tabId: 'browser:1', placement: 'bottom' })
  })
})

describe('rail layout', () => {
  it('reserves just the rail when content is closed and adds it to open-panel width', () => {
    expect(railPushWidth(0, 1280, false)).toBe(44)
    expect(railPushWidth(400, 1280, false)).toBe(444)
  })

  it('mobile drawers keep their original zero-push behavior', () => {
    expect(railPushWidth(400, 390, true)).toBe(0)
  })

  it('stale fullscreen sizes and invalid dimensions cannot exceed the viewport', () => {
    expect(railPushWidth(10000, 1280, false)).toBe(1280)
    expect(railPushWidth(NaN, 1280, false)).toBe(44)
    expect(railPushWidth(400, NaN, false)).toBe(0)
  })
})
