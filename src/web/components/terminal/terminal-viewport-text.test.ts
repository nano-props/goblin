import { describe, expect, test, vi } from 'vitest'
import type { IBufferLine } from '@xterm/xterm'
import { terminalViewportText } from '#/web/components/terminal/terminal-viewport-text.ts'

function line(text: string, isWrapped = false): IBufferLine {
  return {
    isWrapped,
    length: text.length,
    getCell: vi.fn(),
    translateToString: vi.fn(() => text),
  }
}

function viewport(lines: IBufferLine[], rows = lines.length, cols = 80, viewportY = 0) {
  return terminalViewportText({
    buffer: { viewportY, getLine: (index) => lines[index] },
    rows,
    cols,
  })
}

describe('terminalViewportText', () => {
  test('joins soft-wrapped rows and preserves hard line breaks and internal blanks', () => {
    expect(viewport([line('first'), line(' continued', true), line(''), line('last')])).toBe('first continued\n\nlast')
  })

  test('trims empty rows only from the bottom of the visible viewport', () => {
    expect(viewport([line('output'), line(''), line('')])).toBe('output')
    expect(viewport([line(''), line('')])).toBe('')
  })

  test('starts at viewportY without inventing a leading newline for a wrapped first row', () => {
    expect(viewport([line('above'), line('visible continuation', true), line('next')], 2, 80, 1)).toBe(
      'visible continuation\nnext',
    )
  })

  test('bounds translation to the current columns and normalizes xterm non-breaking spaces', () => {
    const visibleLine = line('visible\u00a0text')
    expect(viewport([visibleLine], 1, 12)).toBe('visible text')
    expect(visibleLine.translateToString).toHaveBeenCalledWith(true, 0, 12)
  })

  test('treats unavailable visible rows as blank rows', () => {
    expect(viewport([line('first')], 2)).toBe('first')
  })
})
