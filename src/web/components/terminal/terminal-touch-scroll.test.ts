// @vitest-environment jsdom

import { expect, test, vi } from 'vitest'
import { installTerminalTouchScroll } from '#/web/components/terminal/terminal-touch-scroll.ts'

function dispatchTouches(
  target: EventTarget,
  type: 'touchstart' | 'touchmove',
  touches: Array<{ identifier: number; clientX: number; clientY: number }>,
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: {
      length: touches.length,
      item: (index: number) => touches[index] ?? null,
    },
  })
  target.dispatchEvent(event)
  return event
}

test('translates vertical touch movement into accumulated terminal lines', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  installTerminalTouchScroll({ element, canScroll: () => true, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }])
  const firstMove = dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 102, clientY: 180 }])
  const secondMove = dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 102, clientY: 170 }])

  expect(firstMove.defaultPrevented).toBe(true)
  expect(secondMove.defaultPrevented).toBe(true)
  expect(scrollLines.mock.calls).toEqual([[1], [1]])
})

test('leaves horizontal, multi-touch, and unavailable-buffer gestures untouched', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  let canScroll = true
  installTerminalTouchScroll({ element, canScroll: () => canScroll, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }])
  const horizontalMove = dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 140, clientY: 205 }])
  expect(horizontalMove.defaultPrevented).toBe(false)

  dispatchTouches(element, 'touchstart', [
    { identifier: 2, clientX: 100, clientY: 200 },
    { identifier: 3, clientX: 120, clientY: 200 },
  ])
  canScroll = false
  dispatchTouches(element, 'touchstart', [{ identifier: 4, clientX: 100, clientY: 200 }])
  const unavailableMove = dispatchTouches(element, 'touchmove', [{ identifier: 4, clientX: 100, clientY: 160 }])

  expect(unavailableMove.defaultPrevented).toBe(false)
  expect(scrollLines).not.toHaveBeenCalled()
})

test('removes its listeners when disposed', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  const touchScroll = installTerminalTouchScroll({
    element,
    canScroll: () => true,
    getLineHeight: () => 14,
    scrollLines,
  })

  touchScroll.dispose()
  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }])
  dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 100, clientY: 160 }])

  expect(scrollLines).not.toHaveBeenCalled()
})
