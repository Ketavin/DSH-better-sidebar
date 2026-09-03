/** Native Ctrl/Cmd+wheel binding for viewer-local zoom. */
import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keep browser page zoom out of a viewer that owns content zoom. React's
 * synthetic wheel listener may be passive, so this boundary is deliberately
 * native and non-passive.
 */
export function useCtrlWheelZoom(
  target: RefObject<HTMLElement | null>,
  onZoom: (direction: 1 | -1) => void,
): void {
  const callback = useRef(onZoom)
  callback.current = onZoom

  useEffect(() => {
    const element = target.current
    if (element === null) return
    const handleWheel = (event: WheelEvent): void => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return
      event.preventDefault()
      event.stopPropagation()
      callback.current(event.deltaY < 0 ? 1 : -1)
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    return () => { element.removeEventListener('wheel', handleWheel) }
  }, [target])
}
