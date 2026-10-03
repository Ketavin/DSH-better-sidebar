import { allLeaves, isAgentTabId, type SidebarState } from './state.ts'

export const ACTIVITY_RAIL_WIDTH = 44

/** Existing instances win over creation, including tabs parked in another panel. */
export function railTarget(
  state: SidebarState,
  type: string,
  relatedTypes: readonly string[] = [type],
  focusedFloatTabId?: string,
): { tabId: string; placement: 'top' | 'bottom' | 'float' } | undefined {
  const matches = (tab: { id: string; type: string; path?: string }): boolean => relatedTypes.includes(tab.type)
    && (type !== 'editor' || tab.path === undefined)
    && (type !== 'terminal' || !isAgentTabId(tab.id))
  // Free-window focus is transient shell state, not a persisted pane or tab type.
  const focusedFloat = state.floats.find(float => float.tab.id === focusedFloatTabId && matches(float.tab))
  if (focusedFloat !== undefined) return { tabId: focusedFloat.tab.id, placement: 'float' }
  // The focused bottom pane must win over an older instance stored in the right tree.
  const panes = [
    ...allLeaves(state.splits).map(leaf => ({ leaf, placement: 'top' as const })),
    ...allLeaves(state.bottomSplits).map(leaf => ({ leaf, placement: 'bottom' as const })),
  ]
  const focused = panes.find(({ leaf }) => leaf.id === state.activePane)
  const active = focused?.leaf.tabs.find(tab => tab.id === focused.leaf.active && matches(tab))
  if (active !== undefined && focused !== undefined) return { tabId: active.id, placement: focused.placement }
  for (const [tree, placement] of [[state.splits, 'top'], [state.bottomSplits, 'bottom']] as const) {
    const leaves = allLeaves(tree)
    const ordered = [...leaves.filter(leaf => leaf.id === state.activePane), ...leaves.filter(leaf => leaf.id !== state.activePane)]
    for (const leaf of ordered) {
      const tab = leaf.tabs.find(tab => tab.id === leaf.active && matches(tab)) ?? leaf.tabs.find(matches)
      if (tab !== undefined) return { tabId: tab.id, placement }
    }
  }
  const float = [...state.floats].reverse().find(float => matches(float.tab))
  return float === undefined ? undefined : { tabId: float.tab.id, placement: 'float' }
}

/** Only a visible focused pane or an explicitly focused free window owns the rail. */
export function railActiveType(state: SidebarState, focusedFloatTabId?: string): string | undefined {
  const float = state.floats.find(float => float.tab.id === focusedFloatTabId)
  if (float !== undefined) return float.tab.type
  for (const [tree, open] of [[state.splits, state.panelOpen], [state.bottomSplits, state.bottomOpen]] as const) {
    const leaf = allLeaves(tree).find(leaf => leaf.id === state.activePane)
    if (leaf !== undefined) return open ? leaf.tabs.find(tab => tab.id === leaf.active)?.type : undefined
  }
  return undefined
}

/** The rail contributes to layout even while its content panel is collapsed. */
export function railPushWidth(panelWidth: number, viewportWidth: number, narrow: boolean): number {
  if (narrow) return 0
  const viewport = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const panel = Number.isFinite(panelWidth) ? Math.max(0, panelWidth) : 0
  return Math.min(viewport, panel + ACTIVITY_RAIL_WIDTH)
}
