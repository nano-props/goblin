import { describe, expect, test } from 'vitest'
import { isTerminalPastePathSafe } from '#/shared/clipboard-paste.ts'

describe('isTerminalPastePathSafe', () => {
  test('allows ordinary shell metacharacters that shell quoting handles', () => {
    expect(isTerminalPastePathSafe('/tmp/$HOME/notes')).toBe(true)
    expect(isTerminalPastePathSafe("/tmp/it's here.txt")).toBe(true)
    expect(isTerminalPastePathSafe('/tmp/[draft]*.md')).toBe(true)
  })

  test.each([
    ['NUL', '\x00'],
    ['BEL', '\x07'],
    ['TAB', '\x09'],
    ['LF', '\x0a'],
    ['CR', '\x0d'],
    ['ESC', '\x1b'],
    ['DEL', '\x7f'],
    ['CSI', '\x9b'],
  ])('rejects %s control bytes', (_label, control) => {
    expect(isTerminalPastePathSafe(`/tmp/a${control}b`)).toBe(false)
  })
})
