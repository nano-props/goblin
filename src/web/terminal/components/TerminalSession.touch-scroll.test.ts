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

test.each([
  ['normal buffer without mouse tracking', 'normal', true],
  ['alternate buffer', 'alternate', false],
  ['mouse tracking', 'mouse-tracking', false],
] as const)('handles vertical touch scrolling in %s', async (_scenario, configuration, handled) => {
  const { session, term } = await startOpenControllerSession()
  try {
    if (configuration === 'alternate') term.buffer.active.type = 'alternate'
    if (configuration === 'mouse-tracking') term.modes.mouseTrackingMode = 'x10'

    const move = scrollGesture(term.element!, 1)

    expect(move.defaultPrevented).toBe(handled)
    expect(term.scrollLines).toHaveBeenCalledTimes(handled ? 1 : 0)
  } finally {
    session.dispose()
  }
})
