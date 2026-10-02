import { Component, createElement, useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BetterSidebarService, ExplorerViewProps } from './service.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode {
    return this.state.failed ? <p role="alert">{t('explorerViewFailed')}</p> : this.props.children
  }
}

/** Workspace stays mounted: switching views cannot interrupt an upload. */
export function ExplorerViews(props: ExplorerViewProps & { service: BetterSidebarService; children: ReactNode }) {
  const { service, children, ...viewProps } = props
  useSyncExternalStore(
    useCallback(listener => service.subscribeExplorerViews(listener), [service]),
    useCallback(() => service.getExplorerViewRevision(), [service]),
  )
  const [selected, setSelected] = useState('workspace')
  const views = service.getExplorerViews()
  const active = views.find(view => view.id === selected)
  return <>
    {views.length > 0 && <div className={css.explorerViews} role="tablist" aria-label={t('files')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')]
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
      event.preventDefault()
      buttons[next]?.focus()
      buttons[next]?.click()
    }}>
      <button type="button" role="tab" aria-selected={active === undefined} onClick={() => setSelected('workspace')}>{t('explorerWorkspace')}</button>
      {views.map(view => <button type="button" role="tab" key={view.id} aria-selected={active?.id === view.id}
        onClick={() => setSelected(view.id)}>{typeof view.title === 'function' ? view.title() : view.title}</button>)}
    </div>}
    <div className={css.explorerViewContent} hidden={active !== undefined}>{children}</div>
    {active !== undefined && <div className={css.explorerViewContent} role="tabpanel">
      <ViewBoundary key={active.id}>{createElement(active.component, { ...viewProps, visible: props.visible })}</ViewBoundary>
    </div>}
  </>
}
