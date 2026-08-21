import { describe, expect, test } from 'vitest'
import { resolveAdjacentTerminalSelectionAfterRemoval } from '#/web/terminal/components/terminal-session-eviction.ts'

const FIRST = 'term-aaaaaaaaaaaaaaaaaaaaa'
const SECOND = 'term-bbbbbbbbbbbbbbbbbbbbb'
const THIRD = 'term-ccccccccccccccccccccc'

describe('terminal session eviction helpers', () => {
  test.each([
    {
      name: 'selects the right neighbor after removing a middle terminal',
      ids: [FIRST, SECOND, THIRD],
      removed: SECOND,
      expected: THIRD,
    },
    {
      name: 'selects the left neighbor after removing the last terminal',
      ids: [FIRST, SECOND],
      removed: SECOND,
      expected: FIRST,
    },
    { name: 'clears selection after removing the only terminal', ids: [FIRST], removed: FIRST, expected: null },
    {
      name: 'keeps the first terminal when the removed terminal is absent',
      ids: [FIRST, SECOND],
      removed: THIRD,
      expected: FIRST,
    },
  ])('$name', ({ ids, removed, expected }) => {
    expect(resolveAdjacentTerminalSelectionAfterRemoval(ids, removed)).toBe(expected)
  })
})
