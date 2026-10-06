import type { SessionScope } from './api.ts'
import type { BetterSidebarService } from './service.ts'
import { readSidechatQuote, type SidechatQuote } from '../sidechat-quote.ts'
export * from '../sidechat-quote.ts'

/** Explicit user action only; never sends to either conversation. */
export function openSidechatQuote(service: BetterSidebarService | undefined, scope: SessionScope, quote: SidechatQuote): boolean {
  if (service === undefined || !service.features.includes('sidechatQuoteDraft') || !service.isTabEnabled('sidechat')
    || service.getTab('sidechat') === undefined || service.getSnapshot().sessionId !== scope.sessionId
    || quote.source.sessionId !== scope.sessionId || readSidechatQuote(quote) === undefined) return false
  service.openTab({ type: 'sidechat', meta: { quoteDraft: quote }, reveal: true }, scope)
  return true
}

/** Main-chat anchors are Core's public navigation markers, never CSS classes. */
export function chatQuoteSourceElement(anchorKey: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-chat-anchor-key]'))
    .find(element => element.dataset.chatAnchorKey === anchorKey && element.closest('[data-dsh-panel-host]') === null)
}

/** File navigation reopens the file; line coordinates are snapshot references only. */
export function returnToQuoteSource(service: BetterSidebarService | undefined, scope: SessionScope, quote: SidechatQuote): boolean {
  if (service === undefined || quote.source.sessionId !== scope.sessionId || service.getSnapshot().sessionId !== scope.sessionId) return false
  if (quote.source.kind === 'file') {
    if (!service.isTabEnabled('editor') || service.getTab('editor') === undefined) return false
    service.openFile(scope, quote.source.path)
    return true
  }
  const element = chatQuoteSourceElement(quote.source.anchorKey)
  if (element === undefined || !element.isConnected || element.closest('[hidden], [aria-hidden="true"]') !== null) return false
  element.scrollIntoView({ block: 'center' })
  return true
}
