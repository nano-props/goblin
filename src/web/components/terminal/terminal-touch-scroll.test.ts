// @vitest-environment jsdom

import { expect, test, vi } from 'vitest'
import { installTerminalTouchScroll } from '#/web/components/terminal/terminal-touch-scroll.ts'

function dispatchTouches(
  target: EventTarget,
  type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
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
  installTerminalTouchScroll({ element, shouldHandle: () => true, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }])
  const firstMove = dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 102, clientY: 180 }])
  const secondMove = dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 102, clientY: 170 }])

  expect(firstMove.defaultPrevented).toBe(true)
  expect(secondMove.defaultPrevented).toBe(true)
  expect(scrollLines.mock.calls).toEqual([[1], [1]])
})

test('preserves the direction of downward movement', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  installTerminalTouchScroll({ element, shouldHandle: () => true, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 100 }])
  dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 100, clientY: 130 }])

  expect(scrollLines).toHaveBeenCalledWith(-2)
})

test('leaves horizontal gestures untouched', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  installTerminalTouchScroll({ element, shouldHandle: () => true, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }])
  const horizontalMove = dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 140, clientY: 205 }])

  expect(horizontalMove.defaultPrevented).toBe(false)
  expect(scrollLines).not.toHaveBeenCalled()
})

test('stops handling a gesture when another touch is added', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  installTerminalTouchScroll({ element, shouldHandle: () => true, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 2, clientX: 100, clientY: 200 }])
  const multiTouchMove = dispatchTouches(element, 'touchmove', [
    { identifier: 2, clientX: 100, clientY: 200 },
    { identifier: 3, clientX: 120, clientY: 200 },
  ])
  const resumedSingleTouchMove = dispatchTouches(element, 'touchmove', [{ identifier: 2, clientX: 100, clientY: 160 }])

  expect(multiTouchMove.defaultPrevented).toBe(false)
  expect(resumedSingleTouchMove.defaultPrevented).toBe(false)
  expect(scrollLines).not.toHaveBeenCalled()
})

test('leaves gestures untouched when touch scrolling should not be handled', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  installTerminalTouchScroll({ element, shouldHandle: () => false, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 4, clientX: 100, clientY: 200 }])
  const move = dispatchTouches(element, 'touchmove', [{ identifier: 4, clientX: 100, clientY: 160 }])

  expect(move.defaultPrevented).toBe(false)
  expect(scrollLines).not.toHaveBeenCalled()
})

test.each(['touchend', 'touchcancel'] as const)('resets a gesture on %s', (endEvent) => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  installTerminalTouchScroll({ element, shouldHandle: () => true, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 4, clientX: 100, clientY: 200 }])
  dispatchTouches(element, endEvent, [])
  const move = dispatchTouches(element, 'touchmove', [{ identifier: 4, clientX: 100, clientY: 160 }])

  expect(move.defaultPrevented).toBe(false)
  expect(scrollLines).not.toHaveBeenCalled()
})

test('stops an active gesture when handling ownership changes', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  let shouldHandle = true
  installTerminalTouchScroll({ element, shouldHandle: () => shouldHandle, getLineHeight: () => 14, scrollLines })

  dispatchTouches(element, 'touchstart', [{ identifier: 4, clientX: 100, clientY: 200 }])
  shouldHandle = false
  const rejectedMove = dispatchTouches(element, 'touchmove', [{ identifier: 4, clientX: 100, clientY: 160 }])
  shouldHandle = true
  const resumedMove = dispatchTouches(element, 'touchmove', [{ identifier: 4, clientX: 100, clientY: 120 }])

  expect(rejectedMove.defaultPrevented).toBe(false)
  expect(resumedMove.defaultPrevented).toBe(false)
  expect(scrollLines).not.toHaveBeenCalled()
})

test('removes its listeners when disposed', () => {
  const element = document.createElement('div')
  const scrollLines = vi.fn()
  const touchScroll = installTerminalTouchScroll({
    element,
    shouldHandle: () => true,
    getLineHeight: () => 14,
    scrollLines,
  })

  touchScroll.dispose()
  dispatchTouches(element, 'touchstart', [{ identifier: 1, clientX: 100, clientY: 200 }])
  dispatchTouches(element, 'touchmove', [{ identifier: 1, clientX: 100, clientY: 160 }])

  expect(scrollLines).not.toHaveBeenCalled()
})
