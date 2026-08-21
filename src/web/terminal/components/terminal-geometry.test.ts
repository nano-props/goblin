import { describe, expect, test } from 'vitest'
import { createTerminalSizingOptions } from '#/web/terminal/components/terminal-geometry.ts'

describe('terminal-geometry', () => {
  test('builds the shared xterm sizing options', () => {
    expect(createTerminalSizingOptions()).toEqual({
      allowProposedApi: true,
      fontFamily: "'Goblin Mono', monospace",
      fontSize: 14,
      lineHeight: 1,
      rescaleOverlappingGlyphs: true,
      scrollback: 10_000,
    })
  })
})
