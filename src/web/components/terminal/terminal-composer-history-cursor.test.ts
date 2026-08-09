import { describe, expect, test } from 'vitest'
import { TerminalComposerHistoryCursor } from '#/web/components/terminal/terminal-composer-history-cursor.ts'

describe('TerminalComposerHistoryCursor', () => {
  test('browses supplied entries from an empty draft and returns to the original draft', () => {
    const cursor = new TerminalComposerHistoryCursor()
    cursor.updateEntries(['first', 'second'])

    expect(cursor.previous('')).toBe('second')
    expect(cursor.previous('second')).toBe('first')
    expect(cursor.previous('first')).toBe('first')
    expect(cursor.next()).toBe('second')
    expect(cursor.next()).toBe('')
    expect(cursor.next()).toBeUndefined()
  })

  test('does not enter history while the user is editing a non-empty draft', () => {
    const cursor = new TerminalComposerHistoryCursor()
    cursor.updateEntries(['previous'])

    expect(cursor.previous('current\nmultiline')).toBeUndefined()
    expect(cursor.isBrowsing()).toBe(false)
  })

  test('leaves browsing when supplied entries change', () => {
    const cursor = new TerminalComposerHistoryCursor()
    cursor.updateEntries(['previous'])
    expect(cursor.previous('')).toBe('previous')

    cursor.updateEntries(['previous', 'new'])

    expect(cursor.next()).toBeUndefined()
    expect(cursor.previous('')).toBe('new')
  })
})
