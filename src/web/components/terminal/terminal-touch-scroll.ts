const TOUCH_SCROLL_DIRECTION_THRESHOLD_PX = 8

interface TouchScrollGesture {
  identifier: number
  startClientX: number
  startClientY: number
  lastClientY: number
  remainderPx: number
  direction: 'pending' | 'vertical'
}

interface TerminalTouchScrollOptions {
  element: HTMLElement
  shouldHandle: () => boolean
  getLineHeight: () => number
  scrollLines: (lines: number) => void
}

export function installTerminalTouchScroll(options: TerminalTouchScrollOptions): { dispose: () => void } {
  let gesture: TouchScrollGesture | null = null
  const resetGesture = () => {
    gesture = null
  }
  const touchForGesture = (touches: TouchList, identifier: number): Touch | null => {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index)
      if (touch?.identifier === identifier) return touch
    }
    return null
  }
  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1 || !options.shouldHandle()) {
      resetGesture()
      return
    }
    const touch = event.touches.item(0)
    if (!touch) return
    gesture = {
      identifier: touch.identifier,
      startClientX: touch.clientX,
      startClientY: touch.clientY,
      lastClientY: touch.clientY,
      remainderPx: 0,
      direction: 'pending',
    }
  }
  const handleTouchMove = (event: TouchEvent) => {
    if (!gesture || event.touches.length !== 1 || !options.shouldHandle()) {
      resetGesture()
      return
    }
    const touch = touchForGesture(event.touches, gesture.identifier)
    if (!touch) {
      resetGesture()
      return
    }
    if (gesture.direction === 'pending') {
      const totalX = touch.clientX - gesture.startClientX
      const totalY = touch.clientY - gesture.startClientY
      if (Math.hypot(totalX, totalY) < TOUCH_SCROLL_DIRECTION_THRESHOLD_PX) return
      if (Math.abs(totalX) >= Math.abs(totalY)) {
        resetGesture()
        return
      }
      gesture.direction = 'vertical'
    }

    event.preventDefault()
    gesture.remainderPx += gesture.lastClientY - touch.clientY
    gesture.lastClientY = touch.clientY
    const lineHeight = options.getLineHeight()
    if (!(lineHeight > 0)) return
    const lines = Math.trunc(gesture.remainderPx / lineHeight)
    if (lines === 0) return
    gesture.remainderPx -= lines * lineHeight
    options.scrollLines(lines)
  }

  options.element.addEventListener('touchstart', handleTouchStart, { passive: true })
  options.element.addEventListener('touchmove', handleTouchMove, { passive: false })
  options.element.addEventListener('touchend', resetGesture)
  options.element.addEventListener('touchcancel', resetGesture)

  return {
    dispose: () => {
      options.element.removeEventListener('touchstart', handleTouchStart)
      options.element.removeEventListener('touchmove', handleTouchMove)
      options.element.removeEventListener('touchend', resetGesture)
      options.element.removeEventListener('touchcancel', resetGesture)
    },
  }
}
