import { describe, expect, test } from 'vitest'
import { ellipsizeLeftPathByWidth, ellipsizeLeftTextByWidth } from '#/web/lib/display-path.ts'
function measureMonospace(text: string): number {
  return text.length * 10
}

function measureVariableWidth(text: string): number {
  let width = 0
  for (const char of text) {
    if (char === '/') {
      width += 4
      continue
    }
    if (char === 'i') {
      width += 5
      continue
    }
    if (char === 'W') {
      width += 13
      continue
    }
    if (char === '…') {
      width += 9
      continue
    }
    width += 10
  }
  return width
}

describe('ellipsizeLeftTextByWidth', () => {
  test('keeps the longest suffix that fits the measured width', () => {
    expect(ellipsizeLeftTextByWidth('WWWWiiii', 38, measureVariableWidth)).toBe('…iiii')
  })

  test('returns empty when even the ellipsis does not fit', () => {
    expect(ellipsizeLeftTextByWidth('example', 8, measureVariableWidth)).toBe('')
  })
})

describe('ellipsizeLeftPathByWidth', () => {
  test('returns the full path when it already fits', () => {
    expect(ellipsizeLeftPathByWidth('src/example/file.ts', 300, measureMonospace)).toBe('src/example/file.ts')
  })

  test('prefers the longest path suffix that fits the available width', () => {
    expect(ellipsizeLeftPathByWidth('src/example/deeply/nested/file.ts', 240, measureMonospace)).toBe(
      '…/deeply/nested/file.ts',
    )
  })

  test('falls back to truncating the filename tail when no full segment suffix fits', () => {
    expect(ellipsizeLeftPathByWidth('src/example/deeply/nested/file.ts', 70, measureMonospace)).toBe('…ile.ts')
  })

  test('uses actual measured widths rather than character count heuristics', () => {
    expect(ellipsizeLeftPathByWidth('src/example/WideWide/iiiiiiii.ts', 103, measureVariableWidth)).toBe(
      '…/iiiiiiii.ts',
    )
  })
})
