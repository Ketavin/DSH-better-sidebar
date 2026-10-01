import { allLeaves, isAgentTabId, type SidebarState } from './state.ts'

export const ACTIVITY_RAIL_WIDTH = 44

/** Existing instances win over creation, including tabs parked in another panel. */
export function railTarget(state: SidebarState, type: string): { tabId: string; placement: 'top' | 'bottom' | 'float' } | undefined {
  const matches = (tab: { id: string; type: string; path?: string }): boolean => tab.type === type
    && (type !== 'editor' || tab.path === undefined)
    && (type !== 'terminal' || !isAgentTabId(tab.id))
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

/** The rail contributes to layout even while its content panel is collapsed. */
export function railPushWidth(panelWidth: number, viewportWidth: number, narrow: boolean): number {
  if (narrow) return 0
  const viewport = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0
  const panel = Number.isFinite(panelWidth) ? Math.max(0, panelWidth) : 0
  return Math.min(viewport, panel + ACTIVITY_RAIL_WIDTH)
}
