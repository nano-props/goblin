// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import {
  preloadTerminalFont,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
} from '#/web/components/terminal/terminal-geometry.ts'

describe('terminal-geometry', () => {
  test('exports the page-lifetime font constants', () => {
    expect(TERMINAL_FONT_SIZE).toBe(14)
    expect(TERMINAL_FONT_FAMILY).toBe(
      "'Goblin Mono', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', monospace",
    )
    expect(TERMINAL_LINE_HEIGHT).toBe(1)
  })

  test('preloadTerminalFont is a no-op when document.fonts.check is unavailable', async () => {
    // jsdom does not implement document.fonts.check / .load, so the
    // function should resolve immediately.
    await expect(preloadTerminalFont()).resolves.toBeUndefined()
  })
})
