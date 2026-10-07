// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { PdfView } from '../src/client/PdfView.tsx'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(() => {
  act(() => root?.unmount()); root = undefined
  container?.remove(); container = undefined
  vi.unstubAllGlobals()
})
describe('PDF in-panel full content', () => {
  it('reopens native PDF controls with the same cached bytes and iframe, revoking each replaced URL', async () => {
    const fetchPdf = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }))
    let urlSequence = 0
    const createObjectURL = vi.fn((_blob: Blob | MediaSource) => `blob:http://localhost/pdf-fixture-${++urlSequence}`), revokeObjectURL = vi.fn()
    const OriginalURL = URL
    vi.stubGlobal('URL', class extends OriginalURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    })
    vi.stubGlobal('fetch', fetchPdf)
    container = document.createElement('div'); document.body.append(container)
    root = createRoot(container)
    const render = async (contentFocus?: boolean) => {
      await act(async () => root!.render(createElement(PdfView, {
        scope: { sessionId: 's1', cwd: '/tmp' }, path: '/tmp/a.pdf', title: 'a.pdf', contentFocus,
      })))
    }
    await render()
    const frame = container.querySelector('iframe')!, download = container.querySelector('a')!
    expect(frame.src).toBe('blob:http://localhost/pdf-fixture-1')
    await render(true)
    expect(container.querySelector('iframe')).toBe(frame)
    expect(container.querySelector('a')).toBe(download)
    expect(new OriginalURL(frame.src).hash).toBe('#toolbar=0&navpanes=0')
    expect(frame.src).toBe('blob:http://localhost/pdf-fixture-2#toolbar=0&navpanes=0')
    await render(false)
    expect(container.querySelector('iframe')).toBe(frame)
    expect(frame.src).toBe('blob:http://localhost/pdf-fixture-3')
    expect(fetchPdf).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledTimes(3)
    expect(createObjectURL.mock.calls[0]![0]).toBeInstanceOf(Blob)
    expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe('application/pdf')
    expect(createObjectURL.mock.calls.every(call => call[0] === createObjectURL.mock.calls[0]![0])).toBe(true)
    expect(revokeObjectURL.mock.calls).toEqual([['blob:http://localhost/pdf-fixture-1'], ['blob:http://localhost/pdf-fixture-2']])
    act(() => root!.unmount()); root = undefined
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:http://localhost/pdf-fixture-3')
  })
})
