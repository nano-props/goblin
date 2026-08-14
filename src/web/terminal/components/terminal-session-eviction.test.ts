import { describe, expect, test } from 'vitest'
import { resolveAdjacentTerminalSelectionAfterRemoval } from '#/web/terminal/components/terminal-session-eviction.ts'

describe('terminal session eviction helpers', () => {
  test('selects the adjacent tab after removing the active terminal', () => {
    expect(
      resolveAdjacentTerminalSelectionAfterRemoval(
        ['term-aaaaaaaaaaaaaaaaaaaaa', 'term-bbbbbbbbbbbbbbbbbbbbb', 'term-ccccccccccccccccccccc'],
        'term-bbbbbbbbbbbbbbbbbbbbb',
      ),
    ).toBe('term-ccccccccccccccccccccc')
    expect(
      resolveAdjacentTerminalSelectionAfterRemoval(
        ['term-aaaaaaaaaaaaaaaaaaaaa', 'term-bbbbbbbbbbbbbbbbbbbbb'],
        'term-bbbbbbbbbbbbbbbbbbbbb',
      ),
    ).toBe('term-aaaaaaaaaaaaaaaaaaaaa')
    expect(
      resolveAdjacentTerminalSelectionAfterRemoval(['term-aaaaaaaaaaaaaaaaaaaaa'], 'term-aaaaaaaaaaaaaaaaaaaaa'),
    ).toBeNull()
  })
})
