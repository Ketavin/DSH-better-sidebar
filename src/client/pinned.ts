/**
 * Cross-session pinned-terminal resolution (v0.17.0+).
 *
 * A pinned terminal tab lives in its HOME session's state (the only
 * authoritative copy) — switching sessions never copies or projects it.
 * The viewer session's TabBar renders the tabs OTHER sessions have pinned
 * as VIRTUAL tabs appended to the first leaf's tab list, so the user sees
 * them inline with their own tabs. Clicking a virtual tab activates it
 * in-place: TerminalView connects to the home session's PTY via WebSocket
 * (sessionId + tab query params resolve to the home PTY on the host side),
 * so the terminal renders in the current workbench without jumping sessions.
 *
 * Visibility rule:
 *
 * | pin.scope | visible when |
 * |-----------|--------------|
 * | `global`  | any session (cwd-independent) |
 * | `workspace` | both cwd values are known and identify the same workspace |
 *
 * Workspace isolation fails closed. During hydration an unresolved cwd keeps
 * the pin hidden until the next store notification supplies the real cwd; a
 * pin created without a home cwd is invalid and never widens to global.
 *
 * The viewer's OWN session is excluded: its pinned tabs are already on its
 * own tab strip, so rendering them again as virtual tabs would double-show.
 * Tabs whose `pin` field is missing or whose `type` is not `'terminal'` are
 * ignored — only terminal tabs can be pinned.
 */
import type { SidebarState, SidebarTab, SplitNode } from './state.ts'

/** A pinned terminal surfaced to the viewer, paired with its home session. */
export interface PinnedTabEntry {
  tab: SidebarTab
  homeSessionId: string
}

/** A viewer's session identity for visibility resolution. */
export interface PinnedViewer {
  sessionId: string
  cwd: string | undefined
}

/** The home-session scope stored on a pinned virtual tab's meta, so
 *  TerminalView connects to the home session's PTY (not the viewer's). */
export interface PinnedHomeScope {
  sessionId: string
  cwd: string | undefined
  /** The original tab id in the home session (TerminalView's `tab` param). */
  tabId: string
}

const PINNED_META_KEY = '__pinnedHome'
const PINNED_VID_PREFIX = 'pinned:'

/** Whether a tab id is a pinned virtual id (prefixed). */
export function isPinnedVirtualId(tabId: string): boolean {
  return tabId.startsWith(PINNED_VID_PREFIX)
}

/** Parse a pinned virtual id into its home session id and original tab id.
 *  Format: `pinned:<homeSessionId>:<originalTabId>` — session ids are UUIDs
 *  (no colons), so the first colon after the prefix delimits the session. */
export function parsePinnedVirtualId(tabId: string): { homeSessionId: string; tabId: string } {
  const rest = tabId.slice(PINNED_VID_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep < 0) return { homeSessionId: rest, tabId: '' }
  return { homeSessionId: rest.slice(0, sep), tabId: rest.slice(sep + 1) }
}

/** Extract the home scope from a pinned virtual tab's meta (undefined for
 *  regular tabs). */
export function getPinnedHomeScope(tab: SidebarTab): PinnedHomeScope | undefined {
  const meta = tab.meta as Record<string, unknown> | undefined
  return (meta?.[PINNED_META_KEY] as PinnedHomeScope | undefined) ?? undefined
}

/** Whether a tab is a pinned virtual tab (injected from another session). */
export function isPinnedVirtualTab(tab: SidebarTab): boolean {
  return getPinnedHomeScope(tab) !== undefined
}

/** Create a virtual SidebarTab for a pinned entry. The virtual id is unique
 *  (prefixed with home session) to avoid collision with the viewer's own
 *  tab ids; the original id is stored in meta for TerminalView. */
export function createPinnedVirtualTab(entry: PinnedTabEntry): SidebarTab {
  const { tab, homeSessionId } = entry
  const home: PinnedHomeScope = {
    sessionId: homeSessionId,
    cwd: tab.pin?.homeCwd,
    tabId: tab.id,
  }
  return {
    ...tab,
    id: PINNED_VID_PREFIX + homeSessionId + ':' + tab.id,
    meta: { ...(tab.meta as Record<string, unknown> | undefined ?? {}), [PINNED_META_KEY]: home },
  }
}

/** Normalize a cwd for workspace identity without importing Node path APIs
 * into the browser bundle. Windows drive and explicit backslash-UNC paths
 * compare case-insensitively; POSIX paths remain case-sensitive. A leading
 * forward `//` is ambiguous without a host-platform signal, so it stays
 * case-sensitive (fail closed rather than merging two POSIX workspaces). */
export function normalizeWorkspaceCwd(cwd: string): string {
  const trimmed = cwd.trim()
  const windowsLike = /^[a-z]:[\\/]/i.test(trimmed) || trimmed.startsWith('\\\\')
  let normalized = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  // Preserve POSIX and Windows drive roots; trimming `C:/` to `C:` would
  // turn an absolute workspace identity into a drive-relative one.
  if (normalized.length > 1 && !/^[a-z]:\/$/i.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '')
  }
  if (windowsLike) normalized = normalized.toLowerCase()
  return normalized
}

/** Whether two resolved cwd strings identify the same workspace. */
export function sameWorkspaceCwd(left: string, right: string): boolean {
  const a = normalizeWorkspaceCwd(left)
  const b = normalizeWorkspaceCwd(right)
  return a !== '' && b !== '' && a === b
}

/** Validate a requested active virtual id against the current injected set. */
export function activePinnedIdFor(
  pinned: readonly SidebarTab[],
  requested: string | null,
): string | null {
  if (requested === null) return null
  return pinned.some(tab => tab.id === requested) ? requested : null
}

/** Inactive virtual terminals stay represented in the tab strip but do not
 * mount xterm/WebSocket resources. Ordinary tabs retain the workbench's
 * keep-mounted behavior. */
export function shouldRenderPinnedContent(tab: SidebarTab, active: boolean): boolean {
  return !isPinnedVirtualTab(tab) || active
}

/** Inject pinned virtual tabs into the first leaf of a split tree, and
 *  override that leaf's `active` when a pinned tab is activated. Returns
 *  the original tree when there are no pinned tabs and no active override. */
export function injectPinnedIntoTree(
  tree: SplitNode,
  pinned: readonly SidebarTab[],
  activePinnedId: string | null,
): SplitNode {
  const active = activePinnedIdFor(pinned, activePinnedId)
  if (pinned.length === 0 && active === null) return tree
  if (tree.kind === 'leaf') {
    return {
      ...tree,
      tabs: pinned.length > 0 ? [...tree.tabs, ...pinned] : tree.tabs,
      active: active ?? tree.active,
    }
  }
  return {
    ...tree,
    children: [
      injectPinnedIntoTree(tree.children[0]!, pinned, active),
      ...tree.children.slice(1),
    ],
  }
}

/**
 * Whether a pinned tab is visible to the viewer session. Workspace scope is
 * fail-closed: both cwd values must be present and identify the same path.
 */
export function pinnedVisibleTo(tab: SidebarTab, viewer: PinnedViewer): boolean {
  const pin = tab.pin
  if (pin === undefined) return false
  if (pin.scope === 'global') return true
  // workspace scope
  const home = pin.homeCwd
  if (home === undefined || viewer.cwd === undefined) return false
  return sameWorkspaceCwd(viewer.cwd, home)
}

/**
 * Collect every pinned terminal visible to the viewer across ALL cached
 * session states. Excludes the viewer's own session (those tabs are on its
 * own strip). Order is stable: sessions in the cache's insertion order,
 * tabs in tree order (splits → bottomSplits → floats) within each session
 * — the order tabs were opened/pinned, so the rail never reorders between
 * renders.
 */
export function collectPinnedTabs(
  bySession: ReadonlyMap<string, SidebarState>,
  viewer: PinnedViewer,
): PinnedTabEntry[] {
  const entries: PinnedTabEntry[] = []
  for (const [homeSessionId, state] of bySession) {
    if (homeSessionId === viewer.sessionId) continue
    collectFromTree(state.splits, homeSessionId, viewer, entries)
    collectFromTree(state.bottomSplits, homeSessionId, viewer, entries)
    for (const float of state.floats) {
      if (float.tab.type === 'terminal' && pinnedVisibleTo(float.tab, viewer)) {
        entries.push({ tab: float.tab, homeSessionId })
      }
    }
  }
  return entries
}

/** Walk one split tree depth-first, collecting visible pinned terminals. */
function collectFromTree(
  node: SidebarState['splits'],
  homeSessionId: string,
  viewer: PinnedViewer,
  out: PinnedTabEntry[],
): void {
  if (node.kind === 'leaf') {
    for (const tab of node.tabs) {
      if (tab.type === 'terminal' && pinnedVisibleTo(tab, viewer)) {
        out.push({ tab, homeSessionId })
      }
    }
    return
  }
  for (const child of node.children) collectFromTree(child, homeSessionId, viewer, out)
}
