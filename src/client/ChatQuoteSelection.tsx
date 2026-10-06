import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '../context-types.ts'
import type { SessionScope } from './api.ts'
import { captureSidechatQuote, openSidechatQuote, type SidechatQuote } from './sidechat-quote.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** Only a settled, single main-chat node can be captured as a message excerpt. */
export function selectedChatQuote(selection: Selection | null, sessionId: string): SidechatQuote | undefined {
  if (selection === null || selection.isCollapsed || selection.rangeCount !== 1 || selection.toString().trim() === '') return undefined
  const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement
  const focus = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement
  const row = anchor?.closest<HTMLElement>('[data-chat-anchor-key]')
  if (row === undefined || row === null || focus === undefined || focus === null || !row.contains(focus)
    || row.dataset.chatAnchorKey === undefined || row.dataset.chatAnchorKey === ''
    || anchor?.closest('[contenteditable="true"], input, textarea, [role="dialog"], [data-dsh-panel-host]') !== null
    || row.querySelector('[data-streaming="true"]') !== null || row.closest('[hidden], [aria-hidden="true"]') !== null) return undefined
  return captureSidechatQuote(selection.toString(), { kind: 'chat', sessionId, anchorKey: row.dataset.chatAnchorKey })
}

/** Mounted once with the Sidebar; no main-chat source or composer mutation. */
export function ChatQuoteSelection({ ctx, scope }: { ctx: Context; scope: SessionScope }): React.ReactNode {
  const [popup, setPopup] = useState<{ quote: SidechatQuote; left: number; top: number } | null>(null)
  useEffect(() => {
    const hide = (): void => { setPopup(null) }
    const capture = (event: Event): void => {
      if (event.target instanceof Element && event.target.closest('[data-sidechat-quote-action]') !== null) return
      const service = ctx.get('betterSidebar')
      if (service?.isTabEnabled('sidechat') !== true) { hide(); return }
      const selection = window.getSelection()
      const quote = selectedChatQuote(selection, scope.sessionId)
      if (quote === undefined || selection === null) { hide(); return }
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      setPopup({ quote, left: Math.min(Math.max(rect.left + rect.width / 2, 100), window.innerWidth - 100), top: Math.max(40, rect.top) })
    }
    const onSelectKey = (event: KeyboardEvent): void => { if (event.shiftKey && /^(Arrow|Home|End)/.test(event.key)) capture(event) }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') hide() }
    document.addEventListener('mouseup', capture)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onSelectKey)
    window.addEventListener('blur', hide)
    hide()
    return () => {
      document.removeEventListener('mouseup', capture)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('keyup', onSelectKey)
      window.removeEventListener('blur', hide)
    }
  }, [ctx, scope.sessionId])
  if (popup === null || popup.quote.source.sessionId !== scope.sessionId) return null
  return createPortal(
    <button type="button" data-sidechat-quote-action className={css.selectionPopup}
      style={{ left: popup.left, top: popup.top }} onMouseDown={event => { event.preventDefault() }}
      onClick={() => { openSidechatQuote(ctx.get('betterSidebar'), scope, popup.quote); setPopup(null) }}>
      {t('sideChatAskSelection')}
    </button>, document.body,
  )
}
