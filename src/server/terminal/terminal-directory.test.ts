// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { TerminalDirectory } from '#/server/terminal/terminal-directory.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

const WORKTREE_A = requiredWorkspaceId('goblin+file:///workspace-a')
const WORKTREE_B = requiredWorkspaceId('goblin+file:///workspace-b')

interface Entry {
  id: string
  userId: string
  scope: string
  terminalSessionId: string
  worktreeId: WorkspaceId
  mutableTitle: string | null
}

describe('TerminalDirectory', () => {
  test('publishes complete membership exactly once with user-wide durable identity uniqueness', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const first = entry('pty_first', 'term_durable', 'scope_a')

    expect(commit(directory, first)).toBe(true)
    expect(commit(directory, first)).toBe(false)
    expect(commit(directory, entry('pty_conflict', 'term_durable', 'scope_b'))).toBe(false)
    expect(directory.get('pty_first')).toBe(first)
    expect(directory.getByDurableId('user_a', 'term_durable')).toBe(first)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(1)
    expect(directory.catalogRevision('user_a', 'scope_b')).toBe(0)
  })

  test('orders explicit projection changes and ignores uncommitted mutable metadata', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const member = entry('pty_first', 'term_first', 'scope_a')
    expect(commit(directory, member)).toBe(true)

    member.mutableTitle = 'new title'
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(1)

    expect(directory.touch(member)).toBe(2)

    expect(directory.remove(member)).toBe(true)
    expect(directory.remove(member)).toBe(false)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(3)
  })

  test('releases a scope clock only after membership is empty', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const member = entry('pty_first', 'term_first', 'scope_a')
    expect(commit(directory, member)).toBe(true)

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

    admission?.commit(reserved)
    expect(directory.get('pty_reserved')).toBe(reserved)
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(1)
    expect(() => admission?.commit(reserved)).toThrow('terminal directory reservation already settled')
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

    expect(() => admission?.commit(entry('pty_other', 'term_other', 'scope_a'))).toThrow(
      'terminal directory reservation identity mismatch',
    )
    expect(directory.catalogRevision('user_a', 'scope_a')).toBe(0)
    admission?.abort()
    expect(directory.reserve(entry('pty_retry', 'term_reserved', 'scope_a'))).not.toBeNull()
  })

  test('indexes only committed sessions and promotes the next committed session after removal', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const first = entry('pty_first', 'term_first', 'scope_a')
    const second = entry('pty_second', 'term_second', 'scope_a')
    const prepared = entry('pty_prepared', 'term_prepared', 'scope_a')
    const reservation = directory.reserve(prepared)

    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBeUndefined()
    expect(commit(directory, first)).toBe(true)
    expect(commit(directory, second)).toBe(true)
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBe(first)

    directory.change(first, () => {
      first.mutableTitle = 'changed'
    })
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBe(first)
    expect(directory.remove(first)).toBe(true)
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBe(second)
    expect(directory.remove(second)).toBe(true)
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBeUndefined()

    reservation?.commit(prepared)
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBe(prepared)
  })

  test('isolates the primary index by owner, scope, and canonical worktree identity', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const expected = entry('pty_expected', 'term_expected', 'scope_a', WORKTREE_A)
    expect(commit(directory, expected)).toBe(true)
    expect(commit(directory, entry('pty_other_scope', 'term_other_scope', 'scope_b', WORKTREE_A))).toBe(true)
    expect(commit(directory, entry('pty_other_worktree', 'term_other_worktree', 'scope_a', WORKTREE_B))).toBe(true)
    expect(commit(directory, entry('pty_other_user', 'term_other_user', 'scope_a', WORKTREE_A, 'user_b'))).toBe(true)

    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBe(expected)
    expect(directory.primaryForWorktree('user_a', 'scope_b', WORKTREE_A)?.id).toBe('pty_other_scope')
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_B)?.id).toBe('pty_other_worktree')
    expect(directory.primaryForWorktree('user_b', 'scope_a', WORKTREE_A)?.id).toBe('pty_other_user')
  })

  test('rejects only a mismatched worktree identity without consuming the reservation', () => {
    const directory = new TerminalDirectory<string, Entry>()
    const reserved = entry('pty_reserved', 'term_reserved', 'scope_a', WORKTREE_A)
    const admission = directory.reserve(reserved)

    expect(() => admission?.commit(entry('pty_reserved', 'term_reserved', 'scope_a', WORKTREE_B))).toThrow(
      'terminal directory reservation identity mismatch',
    )
    expect(directory.primaryForWorktree('user_a', 'scope_a', WORKTREE_A)).toBeUndefined()
    admission?.abort()
    expect(directory.reserve(entry('pty_retry', 'term_reserved', 'scope_a', WORKTREE_A))).not.toBeNull()
  })
})

function entry(
  id: string,
  terminalSessionId: string,
  scope: string,
  worktreeId = WORKTREE_A,
  userId = 'user_a',
): Entry {
  return { id, userId, scope, terminalSessionId, worktreeId, mutableTitle: null }
}

function requiredWorkspaceId(input: string): WorkspaceId {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace id fixture')
  return workspaceId
}

function commit(directory: TerminalDirectory<string, Entry>, value: Entry): boolean {
  const admission = directory.reserve(value)
  if (!admission) return false
  admission.commit(value)
  return true
}
