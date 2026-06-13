import { describe, expect, test } from 'vitest'
import {
  deriveLocalBranchFromRemoteRef,
  normalizeCreateWorktreeInput,
  parseRemoteTrackingRefs,
} from '#/shared/worktree-create.ts'

describe('worktree create helpers', () => {
  test('accepts a new branch create request', () => {
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      }),
    ).toEqual({
      worktreePath: '/tmp/repo-feature',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })
  })

  test('accepts existing branch and trackRemoteBranch requests', () => {
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-existing',
        mode: { kind: 'existingBranch', branch: 'feature/existing' },
      }),
    ).toMatchObject({ mode: { kind: 'existingBranch', branch: 'feature/existing' } })

    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo-track',
        mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'feature/a' },
      }),
    ).toMatchObject({
      mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'feature/a' },
    })
  })

  test('rejects malformed requests', () => {
    expect(
      normalizeCreateWorktreeInput({ worktreePath: '', mode: { kind: 'existingBranch', branch: 'main' } }),
    ).toBeNull()
    expect(
      normalizeCreateWorktreeInput({
        worktreePath: '/tmp/repo',
        mode: { kind: 'trackRemoteBranch', remoteRef: 'origin/feature/a', localBranch: 'bad branch' },
      }),
    ).toBeNull()
    expect(normalizeCreateWorktreeInput({ worktreePath: '/tmp/repo', mode: { kind: 'unknown' } })).toBeNull()
    expect(
      normalizeCreateWorktreeInput({ worktreePath: '/tmp/repo', mode: { kind: 'detached', ref: 'main' } }),
    ).toBeNull()
  })

  test('parses and filters remote-tracking refs', () => {
    expect(parseRemoteTrackingRefs('origin/HEAD\norigin/main\norigin/feature/a\nupstream/release/v1\n')).toEqual([
      'origin/main',
      'origin/feature/a',
      'upstream/release/v1',
    ])
  })

  test('derives local branch names from remote refs', () => {
    expect(deriveLocalBranchFromRemoteRef('origin/feature/a')).toBe('feature/a')
    expect(deriveLocalBranchFromRemoteRef('upstream/release/v1')).toBe('release/v1')
    expect(deriveLocalBranchFromRemoteRef('origin/HEAD')).toBeNull()
  })
})
