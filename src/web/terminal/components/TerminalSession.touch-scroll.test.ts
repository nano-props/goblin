// @vitest-environment jsdom

import { beforeEach, expect, test } from 'vitest'
import { resetTerminalSessionHarness, startOpenControllerSession } from '#/web/test-utils/terminal-session.ts'

function dispatchTouch(
  target: EventTarget,
  type: 'touchstart' | 'touchmove',
  touch: { identifier: number; clientX: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: {
      length: 1,
      item: (index: number) => (index === 0 ? touch : null),
    },
  })
  target.dispatchEvent(event)
  return event
}

function scrollGesture(element: HTMLElement, identifier: number) {
  dispatchTouch(element, 'touchstart', { identifier, clientX: 100, clientY: 200 })
  return dispatchTouch(element, 'touchmove', { identifier, clientX: 100, clientY: 100 })
}

beforeEach(resetTerminalSessionHarness)

test('supports vertical touch scrolling only in the normal buffer without mouse tracking', async () => {
  const { session, term } = await startOpenControllerSession()
  const element = term.element!

  const normalMove = scrollGesture(element, 1)
  expect(normalMove.defaultPrevented).toBe(true)
  expect(term.scrollLines).toHaveBeenCalled()

  term.scrollLines.mockClear()
  term.buffer.active.type = 'alternate'
  const alternateMove = scrollGesture(element, 2)
  expect(alternateMove.defaultPrevented).toBe(false)
  expect(term.scrollLines).not.toHaveBeenCalled()

  term.buffer.active.type = 'normal'
  term.modes.mouseTrackingMode = 'x10'
  const mouseTrackingMove = scrollGesture(element, 3)
  expect(mouseTrackingMove.defaultPrevented).toBe(false)
  expect(term.scrollLines).not.toHaveBeenCalled()

  session.dispose()
})
