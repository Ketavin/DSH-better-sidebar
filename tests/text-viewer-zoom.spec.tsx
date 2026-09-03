// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import './browser-globals.ts'
import { TextEditor } from '../src/client/TextEditor.tsx'
import { createSidebarStore } from '../src/client/state.ts'
import type { FileViewerProps } from '../src/client/service.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

describe('TextEditor viewer-local zoom', () => {
  it('captures Ctrl+wheel inside the viewer without consuming a plain scroll', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const props: FileViewerProps = {
      ctx: {} as FileViewerProps['ctx'],
      store: createSidebarStore(),
      scope: { sessionId: 'zoom-session', cwd: '/tmp' },
      path: '/tmp/notes.md',
      title: 'notes.md',
      viewerId: 'markdown',
      content: '# Notes\n\nReadable content.',
    }
    act(() => { root?.render(<TextEditor {...props} />) })

    const viewer = container.querySelector<HTMLElement>('[data-content-zoom]')!
    expect(viewer.dataset.contentZoom).toBe('100%')

    const ctrlWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })
    act(() => { viewer.dispatchEvent(ctrlWheel) })
    expect(ctrlWheel.defaultPrevented).toBe(true)
    expect(viewer.dataset.contentZoom).toBe('110%')
    expect(viewer.style.getPropertyValue('--dsh-sidebar-content-font-size')).toBe('14.3px')
    expect(viewer.style.getPropertyValue('--dsh-sidebar-content-line-height')).toBe('22px')

    const plainWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
    act(() => { viewer.dispatchEvent(plainWheel) })
    expect(plainWheel.defaultPrevented).toBe(false)
    expect(viewer.dataset.contentZoom).toBe('110%')
  })
})
