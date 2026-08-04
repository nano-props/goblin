// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest'
import {
  resetTerminalSessionHarness,
  startOpenControllerSession,
  terminalRect,
} from '#/web/test-utils/terminal-session.ts'

function viewport(height: number): VisualViewport {
  const target = new EventTarget()
  Object.defineProperties(target, {
    height: { configurable: true, value: height },
    offsetTop: { configurable: true, value: 0 },
  })
  return target as VisualViewport
}

beforeEach(resetTerminalSessionHarness)

test('reveals later xterm cursor rows through the session view event boundary', async () => {
  const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport(300) })

  try {
    const { session, term } = await startOpenControllerSession()
    try {
      const element: HTMLElement = term.element
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(terminalRect(400, 800))
      const marker = element.querySelector<HTMLElement>('[aria-hidden="true"]')
      if (!marker) throw new Error('terminal viewport reveal marker was not installed')
      marker.scrollIntoView = vi.fn()

      term.buffer.active.cursorY = 20
      term.focus()
      await vi.runAllTimersAsync()
      expect(marker.scrollIntoView).toHaveBeenCalledOnce()

      term.emitCursorMove()
      await vi.runAllTimersAsync()
      expect(marker.scrollIntoView).toHaveBeenCalledOnce()

      term.buffer.active.cursorY = 24
      term.emitCursorMove()
      await vi.runAllTimersAsync()
      expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)

      term.buffer.active.cursorY = 26
      term.resize(term.cols - 1, term.rows)
      await vi.runAllTimersAsync()
      expect(marker.scrollIntoView).toHaveBeenCalledTimes(3)

      session.dispose()
      term.buffer.active.cursorY = 27
      term.emitCursorMove()
      term.resize(term.cols - 1, term.rows)
      await vi.runAllTimersAsync()
      expect(marker.scrollIntoView).toHaveBeenCalledTimes(3)
    } finally {
      session.dispose()
    }
  } finally {
    if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    else Reflect.deleteProperty(window, 'visualViewport')
  }
})
