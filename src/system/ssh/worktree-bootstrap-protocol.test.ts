import { describe, expect, test } from 'vitest'
import {
  decodeRemoteWorktreeBootstrapRecords,
  REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS,
} from '#/system/ssh/worktree-bootstrap-protocol.ts'
import { encodeRemoteWorktreeBootstrapRecord } from '#/test-utils/remote-worktree-bootstrap.ts'

describe('remote worktree bootstrap protocol', () => {
  test('round-trips POSIX paths and setup commands containing newlines', () => {
    const path = 'config/line\nbreak.env'
    const setup = "printf 'line one\\nline two\\n'"
    const output =
      encodeRemoteWorktreeBootstrapRecord('copy', path) + encodeRemoteWorktreeBootstrapRecord('setup', setup)

    expect(decodeRemoteWorktreeBootstrapRecords(output)).toEqual([
      { kind: 'copy', value: path },
      { kind: 'setup', value: setup },
    ])
  })

  test('ignores an unterminated final record while preserving complete records', () => {
    const complete = encodeRemoteWorktreeBootstrapRecord('missing', 'missing.env')
    const truncated = `${REMOTE_WORKTREE_BOOTSTRAP_RECORD_TAGS.copy}\0partial-path`

    expect(decodeRemoteWorktreeBootstrapRecords(complete + truncated)).toEqual([
      { kind: 'missing', value: 'missing.env' },
    ])
    expect(decodeRemoteWorktreeBootstrapRecords(truncated)).toEqual([])
  })

  test('preserves a complete record when the next tag is truncated', () => {
    const complete = encodeRemoteWorktreeBootstrapRecord('copy', 'complete.env')

    expect(decodeRemoteWorktreeBootstrapRecords(`${complete}GOBLIN_BOOT`)).toEqual([
      { kind: 'copy', value: 'complete.env' },
    ])
  })
})
