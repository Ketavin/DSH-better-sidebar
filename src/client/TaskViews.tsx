import { Component, createElement, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BetterSidebarService, TaskViewProps } from './service.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

class ViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): ReactNode {
    return this.state.failed ? <p role="alert">{t('taskViewFailed')}</p> : this.props.children
  }
}

/** One Tasks entry with removable child views. Hidden native Tasks stop polling. */
export function TaskViews(props: TaskViewProps & {
  service: BetterSidebarService
  renderTasks(active: boolean): ReactNode
}) {
  const { service, renderTasks, ...viewProps } = props
  useSyncExternalStore(
    useCallback(listener => service.subscribeTaskViews(listener), [service]),
    useCallback(() => service.getTaskViewRevision(), [service]),
  )
  const [selected, setSelected] = useState({ sessionId: props.scope.sessionId, id: 'tasks' })
  const views = service.getTaskViews()
  const active = selected.sessionId === props.scope.sessionId ? views.find(view => view.id === selected.id) : undefined
  useEffect(() => {
    if (selected.sessionId !== props.scope.sessionId || (selected.id !== 'tasks' && active === undefined)) {
      setSelected({ sessionId: props.scope.sessionId, id: 'tasks' })
    }
  }, [selected, props.scope.sessionId, active])
  const select = (id: string): void => setSelected({ sessionId: props.scope.sessionId, id })
  return <>
    {views.length > 0 && <div className={css.explorerViews} role="tablist" aria-label={t('subagent')} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')]
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
      event.preventDefault()
      buttons[next]?.focus()
      buttons[next]?.click()
    }}>
      <button type="button" role="tab" aria-selected={active === undefined} onClick={() => select('tasks')}>{t('subagent')}</button>
      {views.map(view => <button type="button" role="tab" key={view.id} aria-selected={active === view}
        onClick={() => select(view.id)}>{typeof view.title === 'function' ? view.title() : view.title}</button>)}
    </div>}
    <div className={css.explorerViewContent} hidden={active !== undefined}>{renderTasks(props.visible && active === undefined)}</div>
    {active !== undefined && props.visible && <div className={css.explorerViewContent} role="tabpanel">
      <ViewBoundary key={`${props.scope.sessionId}:${active.id}`}>{createElement(active.component, viewProps)}</ViewBoundary>
    </div>}
  </>
}
