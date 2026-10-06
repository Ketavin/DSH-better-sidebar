// @vitest-environment jsdom
import './browser-globals.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { Context } from '../src/context-types.ts'
import { TextEditor } from '../src/client/TextEditor.tsx'
import { ChatQuoteSelection } from '../src/client/ChatQuoteSelection.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore } from '../src/client/state.ts'
import { registerBuiltins } from '../src/client/builtins/index.ts'
import { sidechatQuoteFromMeta } from '../src/client/sidechat-quote.ts'
import { t } from '../src/client/locales.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let dispose: (() => void) | undefined
afterEach(() => { act(() => { root?.unmount() }); root = undefined; dispose?.(); document.body.innerHTML = ''; localStorage.clear(); vi.restoreAllMocks() })

function setup() {
  const store = createSidebarStore(); store.setSession('parent')
  const service = createBetterSidebarService(store)
  const setDraft = vi.fn()
  const ctx = {
    get: (key: string) => key === 'betterSidebar' ? service : key === 'conversation' ? {
      input: { for: () => ({ state: { getSnapshot: () => ({ draft: 'existing question' }) }, setDraft }) },
    } : undefined,
    sessions: { scope: () => ({}) },
  } as unknown as Context
  dispose = registerBuiltins(ctx, service)
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const quotes = () => allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).filter(tab => tab.type === 'sidechat')
  return { ctx, store, service, setDraft, container, quotes }
}

function selectText(element: Element): void {
  const range = document.createRange(); range.selectNodeContents(element)
  range.getBoundingClientRect = () => ({ left: 180, top: 150, width: 90, height: 20 }) as DOMRect
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  act(() => { element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
}

function clickText(text: string): void {
  const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent === text)!
  expect(button).toBeDefined()
  act(() => { button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); button.click() })
}

describe('quote producers', () => {
  it('keeps the existing file-to-main-draft action and adds a separate SideChat quote', () => {
    const { ctx, store, setDraft, container, quotes } = setup()
    act(() => { root!.render(<TextEditor ctx={ctx} store={store} scope={{ sessionId: 'parent', cwd: '/work' }}
      path="/work/notes.md" title="notes.md" viewerId="markdown" content={'# Notes\n\nSelected evidence.'} />) })
    const paragraph = Array.from(container.querySelectorAll('p')).find(item => item.textContent === 'Selected evidence.')!
    expect(paragraph).toBeDefined()
    selectText(paragraph); clickText(t('addToConversation'))
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('existing question'))
    expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('Selected evidence.'))
    expect(quotes()).toHaveLength(0)
    selectText(paragraph); clickText(t('sideChatAskSelection'))
    expect(quotes()).toHaveLength(1)
    expect(sidechatQuoteFromMeta(quotes()[0]!.meta)).toMatchObject({ text: 'Selected evidence.', source: {
      kind: 'file', path: '/work/notes.md', sessionId: 'parent', lines: { start: 3, end: 3 }, snapshot: 'saved',
    } })
    expect(setDraft).toHaveBeenCalledTimes(1)
  })

  it('opens a single-message quote only on the explicit popup action and clears it when the session changes', () => {
    const { ctx, quotes } = setup()
    act(() => { root!.render(<ChatQuoteSelection ctx={ctx} scope={{ sessionId: 'parent' }} />) })
    const message = document.createElement('div'); message.dataset.chatAnchorKey = 'message:4'; message.textContent = 'Settled response'; document.body.append(message)
    selectText(message)
    expect(quotes()).toHaveLength(0)
    clickText(t('sideChatAskSelection'))
    expect(sidechatQuoteFromMeta(quotes()[0]!.meta)).toMatchObject({ text: 'Settled response', source: { kind: 'chat', anchorKey: 'message:4', sessionId: 'parent' } })
    selectText(message)
    act(() => { root!.render(<ChatQuoteSelection ctx={ctx} scope={{ sessionId: 'other' }} />) })
    expect(document.querySelector('[data-sidechat-quote-action]')).toBeNull()
    expect(quotes()).toHaveLength(1)
  })
})
