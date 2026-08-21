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

async function withVisualViewport(height: number, callback: () => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport(height) })
  try {
    await callback()
  } finally {
    if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor)
    else Reflect.deleteProperty(window, 'visualViewport')
  }
}

beforeEach(resetTerminalSessionHarness)

test('reveals on terminal resize but not cursor output, and stops after disposal', async () => {
  await withVisualViewport(300, async () => {
    const { session, term } = await startOpenControllerSession()
    const element: HTMLElement = term.element
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(terminalRect(400, 800))
    const marker = element.querySelector<HTMLElement>('[aria-hidden="true"]')
    if (!marker) throw new Error('terminal viewport reveal marker was not installed')
    marker.scrollIntoView = vi.fn()

    try {
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
      expect(marker.scrollIntoView).toHaveBeenCalledOnce()

      term.buffer.active.cursorY = 26
      term.resize(term.cols - 1, term.rows)
      await vi.runAllTimersAsync()
      expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
    } finally {
      session.dispose()
    }

    term.buffer.active.cursorY = 27
    term.emitCursorMove()
    term.resize(term.cols - 1, term.rows)
    await vi.runAllTimersAsync()
    expect(marker.scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
