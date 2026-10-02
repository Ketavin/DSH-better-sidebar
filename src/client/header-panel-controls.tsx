/**
 * Add panel controls to the host's public Session utility row. A tiny
 * placement store tells the independent panel root whether a visible host
 * header owns the controls. Undeclared slots, blank headers and the mobile
 * drawer all keep the original corner controls as their fallback.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { useNarrowViewport } from './breakpoints.ts'
import { IconPanelBottomOutline16, IconPanelRightOutline16 } from './icons.tsx'
import { t } from './locales.ts'
import { toggleBottomPanel, togglePanel, type SidebarStore } from './state.ts'
import css from './sidebar.module.css'

export interface HeaderControlPlacement {
  getSnapshot(): boolean
  getPresentSnapshot(): boolean
  getCenterSnapshot(): number | undefined
  subscribe(listener: () => void): () => void
  claim(): { setVisible(visible: boolean, center?: number): void; dispose(): void }
}

/** Per-plugin-activation ownership: an old header cannot clear a new one. */
export function createHeaderControlPlacement(): HeaderControlPlacement {
  const owners = new Map<symbol, { visible: boolean; center: number | undefined }>()
  const listeners = new Set<() => void>()
  let visible = false
  let present = false
  let center: number | undefined
  const sync = (): void => {
    const values = [...owners.values()]
    const next = values.some(value => value.visible)
    const nextPresent = owners.size > 0
    const nextCenter = values.reverse().find(value => value.center !== undefined)?.center
    if (next === visible && nextPresent === present && nextCenter === center) return
    visible = next
    present = nextPresent
    center = nextCenter
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => visible,
    getPresentSnapshot: () => present,
    getCenterSnapshot: () => center,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    claim: () => {
      const owner = Symbol('header panel controls')
      owners.set(owner, { visible: false, center: undefined })
      sync()
      return {
        setVisible: (next, nextCenter) => {
          const previous = owners.get(owner)
          if (previous === undefined || (previous.visible === next && previous.center === nextCenter)) return
          owners.set(owner, { visible: next, center: nextCenter })
          sync()
        },
        dispose: () => { owners.delete(owner); sync() },
      }
    },
  }
}

const NO_HEADER_CONTROLS: HeaderControlPlacement = {
  getSnapshot: () => false,
  getPresentSnapshot: () => false,
  getCenterSnapshot: () => undefined,
  subscribe: () => () => {},
  claim: () => ({ setVisible: () => {}, dispose: () => {} }),
}

/** Optional for consumers/tests mounting the panel shell without slot wiring. */
export function useHeaderControlsVisible(placement?: HeaderControlPlacement): boolean {
  const source = placement ?? NO_HEADER_CONTROLS
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

/** Do not change native-header padding as its controls cross a size boundary:
 *  shifting that row would otherwise toggle ownership back and forth. */
export function useHeaderControlsPresent(placement?: HeaderControlPlacement): boolean {
  const source = placement ?? NO_HEADER_CONTROLS
  return useSyncExternalStore(source.subscribe, source.getPresentSnapshot)
}

/** The visible header's measured center also aligns a desktop overflow fallback. */
export function useHeaderControlsCenter(placement?: HeaderControlPlacement): number | undefined {
  const source = placement ?? NO_HEADER_CONTROLS
  return useSyncExternalStore(source.subscribe, source.getCenterSnapshot)
}

/** The public conversation slot wrapper can be display:contents: its box is
 *  empty, while the parent is the actual flexible conversation column. */
function conversationBoundary(node: HTMLElement): HTMLElement | null {
  const pane = node.closest<HTMLElement>('[data-pane="conversation"]')
  const slot = node.closest<HTMLElement>('[data-slot="conversation"]')
  let candidate = pane ?? slot?.parentElement ?? node.closest<HTMLElement>('#root')
  while (candidate !== null && getComputedStyle(candidate).display === 'contents') {
    candidate = candidate.parentElement
  }
  return candidate
}

/** The same actual controls serve both header and corner locations. */
export function PanelToggleButtons({ store, narrow }: { store: SidebarStore; narrow: boolean }) {
  const snapshot = useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.getSnapshot(),
  )
  const state = snapshot.state
  const available = snapshot.sessionId !== undefined && state !== undefined
  const bottomLabel = available ? t(state.bottomOpen ? 'collapseBottomPanel' : 'expandBottomPanel') : t('noSession')
  const sideLabel = available ? t(state.panelOpen ? 'collapse' : 'expand') : t('noSession')
  return (
    <>
      {!narrow && (
        <Tooltip label={bottomLabel} side="bottom" delayMs={500}>
          <button type="button" className={css.toggleButton} aria-label={bottomLabel}
            aria-disabled={available ? undefined : true}
            onClick={available ? () => { store.reduce(toggleBottomPanel) } : undefined}>
            <IconPanelBottomOutline16 />
          </button>
        </Tooltip>
      )}
      <Tooltip label={sideLabel} side="bottom" delayMs={500}>
        <button type="button" className={css.toggleButton} aria-label={sideLabel}
          aria-disabled={available ? undefined : true}
          onClick={available ? () => { store.reduce(togglePanel) } : undefined}>
          <IconPanelRightOutline16 />
        </button>
      </Tooltip>
    </>
  )
}

interface HeaderPanelControlsProps {
  /** Standard session-scoped slot kit supplied by the host. */
  sessionId: string
  ctx: Context
  store: SidebarStore
  placement: HeaderControlPlacement
}

/** Rendered by the native title row, so its center follows Session log. */
export function HeaderPanelControls({ sessionId, ctx, store, placement }: HeaderPanelControlsProps) {
  const snapshot = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  const current = useSyncExternalStore(
    listener => ctx.sessions.list.subscribe(listener),
    () => ctx.sessions.list.getSnapshot().current,
  )
  // The public locale subscription also refreshes the plugin's translated
  // tooltips when the panel root is not the component producing them.
  useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
  const narrow = useNarrowViewport()
  const eligible = current === sessionId && snapshot.sessionId === sessionId
    && snapshot.state !== undefined && !(narrow && snapshot.state.panelOpen)
  const element = useRef<HTMLDivElement>(null)
  const [usable, setUsable] = useState(false)

  useLayoutEffect(() => {
    if (!eligible) return
    const owner = placement.claim()
    const node = element.current
    if (node === null) return owner.dispose
    const pane = conversationBoundary(node)
    let frame: number | null = null
    const measure = (): void => {
      const box = node.getBoundingClientRect()
      const paneBox = pane?.getBoundingClientRect()
      // Never treat the zero box of a structural wrapper as a layout limit.
      const boundary = paneBox !== undefined && paneBox.width > 0 && paneBox.height > 0 ? paneBox : undefined
      // Read inherited visibility outside our own presentation gate. Hiding
      // an unusable group preserves its footprint, so it can recover when
      // the pane widens without a hide/measure/show feedback loop.
      const style = getComputedStyle(node.parentElement ?? node)
      const headerVisible = node.isConnected && box.width > 0 && box.height > 0
        && style.visibility !== 'hidden' && style.visibility !== 'collapse'
      const next = headerVisible
        && box.left >= Math.max(0, boundary?.left ?? 0) - 1
        && box.right <= Math.min(window.innerWidth, boundary?.right ?? window.innerWidth) + 1
        && box.top >= Math.max(0, boundary?.top ?? 0) - 1
        && box.bottom <= Math.min(window.innerHeight, boundary?.bottom ?? window.innerHeight) + 1
      setUsable(previous => previous === next ? previous : next)
      owner.setVisible(next, headerVisible ? box.top + box.height / 2 : undefined)
    }
    const scheduleMeasure = (): void => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => { frame = null; measure() })
    }
    measure()
    // One post-commit pass catches clearance changes on first ownership.
    scheduleMeasure()
    // Observe the available pane too: a sidebar animation narrows that box
    // without changing either the viewport or the 60px controls themselves.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node)
    if (pane !== null) observer?.observe(pane)
    // visibility:hidden does not resize. Watch only this header subtree and
    // its ancestor attributes up through #root (never document/body).
    const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(scheduleMeasure)
    const header = node.closest('header') ?? node.parentElement
    if (header !== null) mutations?.observe(header, { attributes: true, childList: true, subtree: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] })
    for (let ancestor = header?.parentElement; ancestor !== null && ancestor !== undefined
      && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      mutations?.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] })
      if (ancestor.id === 'root') break
    }
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      observer?.disconnect()
      mutations?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      if (frame !== null) cancelAnimationFrame(frame)
      owner.dispose()
    }
  }, [eligible, placement])

  if (!eligible) return null
  return (
    <div ref={element} className={css.headerToggles} data-dsh-header-panel-controls
      aria-hidden={usable ? undefined : true} style={usable ? undefined : { visibility: 'hidden' }}>
      <PanelToggleButtons store={store} narrow={narrow} />
    </div>
  )
}

/** Declaration-aware inject is a no-op on older hosts without this seat. */
export function registerHeaderPanelControls(
  ctx: Context,
  store: SidebarStore,
  placement: HeaderControlPlacement,
): () => void {
  return ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'better-sidebar-panel-controls',
    order: 100,
    inject: () => ({ ctx, store, placement }),
  }, HeaderPanelControls))
}
