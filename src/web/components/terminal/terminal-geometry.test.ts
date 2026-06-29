// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import {
  createTerminalSizingOptions,
  preloadTerminalFont,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCROLLBACK_ROWS,
} from '#/web/components/terminal/terminal-geometry.ts'

describe('terminal-geometry', () => {
  test('exports the page-lifetime font constants', () => {
    expect(TERMINAL_FONT_SIZE).toBe(14)
    expect(TERMINAL_FONT_FAMILY).toBe("'Goblin Mono', monospace")
    expect(TERMINAL_LINE_HEIGHT).toBe(1)
    expect(TERMINAL_SCROLLBACK_ROWS).toBe(10_000)
  })

  test('builds the shared xterm sizing options', () => {
    expect(createTerminalSizingOptions({ cols: 120, rows: 40 })).toEqual({
      allowProposedApi: true,
      cols: 120,
      rows: 40,
      fontFamily: "'Goblin Mono', monospace",
      fontSize: 14,
      lineHeight: 1,
      rescaleOverlappingGlyphs: true,
      scrollback: 10_000,
    })
  })

  test('preloadTerminalFont is a no-op when document.fonts.check is unavailable', async () => {
    // jsdom does not implement document.fonts.check / .load, so the
    // function should resolve immediately.
    await expect(preloadTerminalFont()).resolves.toBeUndefined()
  })
})
