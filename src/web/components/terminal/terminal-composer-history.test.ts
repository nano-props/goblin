import { describe, expect, test } from 'vitest'
import { TerminalComposerHistory } from '#/web/components/terminal/terminal-composer-history.ts'

describe('TerminalComposerHistory', () => {
  test('browses successful submissions from an empty draft and returns to the original draft', () => {
    const history = new TerminalComposerHistory()
    history.record('first')
    history.record('second')

    expect(history.previous('')).toBe('second')
    expect(history.previous('second')).toBe('first')
    expect(history.previous('first')).toBe('first')
    expect(history.next()).toBe('second')
    expect(history.next()).toBe('')
    expect(history.next()).toBeUndefined()
  })

  test('does not enter history while the user is editing a non-empty draft', () => {
    const history = new TerminalComposerHistory()
    history.record('previous')

    expect(history.previous('current\nmultiline')).toBeUndefined()
    expect(history.isBrowsing()).toBe(false)
  })

  test('leaves browsing without deleting recorded entries', () => {
    const history = new TerminalComposerHistory()
    history.record('previous')
    expect(history.previous('')).toBe('previous')

    history.leaveBrowsing()

    expect(history.next()).toBeUndefined()
    expect(history.previous('')).toBe('previous')
  })

  test('coalesces consecutive duplicates and bounds retained entries', () => {
    const history = new TerminalComposerHistory()
    history.record('duplicate')
    history.record('duplicate')
    for (let index = 0; index < 51; index += 1) history.record(`entry-${index}`)

    expect(history.previous('')).toBe('entry-50')
    for (let index = 0; index < 49; index += 1) history.previous('ignored while browsing')
    expect(history.previous('ignored while browsing')).toBe('entry-1')
  })
})
