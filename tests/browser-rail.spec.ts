import { describe, expect, it } from 'vitest'
import { railActiveType, railTarget } from '../src/client/activity-rail.ts'
import { allLeaves, createSidebarStore, floatTab, openTabInActivePane, type SidebarState } from '../src/client/state.ts'

const family = ['browser', 'ego-browser:watch']
function state(): SidebarState {
  const store = createSidebarStore()
  store.setSession('browser-rail-helper')
  return store.getSnapshot().state!
}

describe('Browser family rail targets', () => {
  it('prefers the active bottom Agent tab over an older right Preview', () => {
    let input = openTabInActivePane(state(), { id: 'preview', type: 'browser', title: 'Preview', path: 'https://example.org' })
    input = openTabInActivePane({ ...input, activePane: allLeaves(input.bottomSplits)[0]!.id, bottomOpen: true }, {
      id: 'ego', type: 'ego-browser:watch', title: 'Ego', meta: { space: 'agent-space' },
    })
    const before = structuredClone(input)
    expect(railTarget(input, 'browser', family)).toEqual({ tabId: 'ego', placement: 'bottom' })
    expect(railActiveType(input)).toBe('ego-browser:watch')
    expect(input).toEqual(before)
  })

  it('preserves an active Preview when both real modes exist', () => {
    let input = openTabInActivePane(state(), { id: 'ego', type: 'ego-browser:watch', title: 'Ego' })
    input = openTabInActivePane(input, { id: 'preview', type: 'browser', title: 'Preview' })
    expect(railTarget(input, 'browser', family)).toEqual({ tabId: 'preview', placement: 'top' })
  })

  it('recognizes a focused free-window Agent even with both workbenches closed', () => {
    let input = openTabInActivePane(state(), { id: 'preview', type: 'browser', title: 'Preview' })
    input = openTabInActivePane(input, { id: 'ego', type: 'ego-browser:watch', title: 'Ego' })
    input = { ...floatTab(input, 'ego', 100, 100), panelOpen: false, bottomOpen: false }
    expect(railTarget(input, 'browser', family, 'ego')).toEqual({ tabId: 'ego', placement: 'float' })
    expect(railActiveType(input, 'ego')).toBe('ego-browser:watch')
    expect(railActiveType(input)).toBeUndefined()
  })

  it('does not claim an old Agent tab after that descriptor is disabled or removed', () => {
    const input = openTabInActivePane(state(), { id: 'ego', type: 'ego-browser:watch', title: 'Ego' })
    expect(railTarget(input, 'browser', ['browser'])).toBeUndefined()
    expect(railTarget(input, 'browser', [])).toBeUndefined()
  })

  it('ignores stale free-window focus after closing or docking the window', () => {
    const input = openTabInActivePane({ ...state(), panelOpen: true }, { id: 'preview', type: 'browser', title: 'Preview' })
    expect(railActiveType(input, 'already-closed')).toBe('browser')
    expect(railTarget(input, 'browser', family, 'already-closed')).toEqual({ tabId: 'preview', placement: 'top' })
  })
})
