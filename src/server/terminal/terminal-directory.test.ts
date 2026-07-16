// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { TerminalDirectory } from '#/server/terminal/terminal-directory.ts'

interface Entry {
  id: string
  userId: string
  scope: string
  terminalSessionId: string
  mutableTitle: string | null
}

describe('TerminalDirectory', () => {
  test('publishes complete membership exactly once with user-wide durable identity uniqueness', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const first = entry('pty_first', 'term_durable', 'scope_a')

    expect(directory.publish(first)).toBe(true)
    expect(directory.publish(first)).toBe(false)
    expect(directory.publish(entry('pty_conflict', 'term_durable', 'scope_b'))).toBe(false)
    expect(directory.get('pty_first')).toBe(first)
    expect(directory.getByDurableId('user_a', 'term_durable')).toBe(first)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(1)
    expect(directory.catalogRevision('user_a', 'scope_b')).toBe(0)
  })

  test('orders only membership changes and ignores mutable entry metadata', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const member = entry('pty_first', 'term_first', 'scope_a')
    directory.publish(member)

    member.mutableTitle = 'new title'
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(1)

    expect(directory.remove(member)).toBe(true)
    expect(directory.remove(member)).toBe(false)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(2)
  })

  test('releases a scope clock only after membership is empty', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const member = entry('pty_first', 'term_first', 'scope_a')
    directory.publish(member)

    expect(() => directory.releaseScope('user_a', 'scope_a')).toThrow(
      'cannot release terminal catalog revision with live sessions',
    )
    directory.remove(member)
    directory.releaseScope('user_a', 'scope_a')
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(0)
  })

  test('reserves durable identity without catalog visibility until commit', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const reserved = entry('pty_reserved', 'term_reserved', 'scope_a')
    const admission = directory.reserve(reserved)

    expect(admission).not.toBeNull()
    expect(directory.get('pty_reserved')).toBeUndefined()
    expect(directory.getByDurableId('user_a', 'term_reserved')).toBeUndefined()
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(0)
    expect(directory.reserve(entry('pty_conflict', 'term_reserved', 'scope_a'))).toBeNull()

    expect(admission?.commit(reserved)).toBe(true)
    expect(directory.get('pty_reserved')).toBe(reserved)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(1)
    expect(admission?.commit(reserved)).toBe(false)
  })

  test('aborts a reservation without a revision or close transition', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const reserved = entry('pty_reserved', 'term_reserved', 'scope_a')
    const admission = directory.reserve(reserved)

    admission?.abort()
    expect(directory.get('pty_reserved')).toBeUndefined()
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(0)
    expect(directory.reserve(entry('pty_retry', 'term_reserved', 'scope_a'))).not.toBeNull()
  })

  test('rejects a mismatched entry without consuming the reservation', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const reserved = entry('pty_reserved', 'term_reserved', 'scope_a')
    const admission = directory.reserve(reserved)

    expect(admission?.commit(entry('pty_other', 'term_other', 'scope_a'))).toBe(false)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(0)
    admission?.abort()
    expect(directory.reserve(entry('pty_retry', 'term_reserved', 'scope_a'))).not.toBeNull()
  })
})

function entry(id: string, terminalSessionId: string, scope: string): Entry {
  return { id, userId: 'user_a', scope, terminalSessionId, mutableTitle: null }
}
