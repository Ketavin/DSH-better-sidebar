// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import './browser-globals.ts'
import { ImageView } from '../src/client/builtins/viewers.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

function button(text: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find(candidate => candidate.textContent === text)
  if (found === undefined) throw new Error(`missing button: ${text}`)
  return found
}

describe('ImageView', () => {
  it('fits by default and exposes actual-size plus bounded zoom controls', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root?.render(<ImageView url="/media/wide.png" title="wide.png" />) })
    const image = container.querySelector<HTMLImageElement>('img[alt="wide.png"]')!
    Object.defineProperty(image, 'naturalWidth', { value: 1200 })
    Object.defineProperty(image, 'naturalHeight', { value: 800 })
    act(() => { image.dispatchEvent(new Event('load', { bubbles: true })) })

    const imageView = container.querySelector('[data-image-mode]') as HTMLElement
    expect(container.querySelector('[class*="editorImageStage"]')).not.toBeNull()
    expect(imageView.dataset.imageMode).toBe('fit')
    expect(image.getAttribute('style')).toBeNull()

    const ctrlWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })
    act(() => { imageView.dispatchEvent(ctrlWheel) })
    expect(ctrlWheel.defaultPrevented).toBe(true)
    expect(imageView.dataset.imageMode).toBe('scaled')
    expect(container.querySelector('span')?.textContent).toBe('125%')

    const plainWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })
    act(() => { imageView.dispatchEvent(plainWheel) })
    expect(plainWheel.defaultPrevented).toBe(false)
    expect(container.querySelector('span')?.textContent).toBe('125%')

    act(() => { button('100%').click() })
    expect(imageView.dataset.imageMode).toBe('scaled')
    expect(image.style.width).toBe('1200px')
    expect(image.style.height).toBe('800px')
    expect(container.querySelector('span')?.textContent).toBe('100%')

    act(() => { button('+').click() })
    expect(image.style.width).toBe('1500px')
    expect(container.querySelector('span')?.textContent).toBe('125%')

    const fitButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find(candidate => candidate.textContent !== '−' && candidate.textContent !== '100%' && candidate.textContent !== '+')!
    act(() => { fitButton.click() })
    expect(imageView.dataset.imageMode).toBe('fit')
    expect(image.style.width).toBe('')
    expect(image.style.height).toBe('')
  })
})
