import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import {
  CreateWorktreeExecResultResponseSchema,
  ExecResultResponseSchema,
  RepoMutationExecResultResponseSchema,
} from '#/shared/http-response-schema.ts'
import {
  RepoLogResponseSchema,
  RepoPullRequestsResponseSchema,
  RepoRemoteBranchesResponseSchema,
  RepoSnapshotResponseSchema,
} from '#/shared/repo-response-schema.ts'

describe('repo response schemas', () => {
  test('accepts legal empty repository reads', () => {
    expect(v.parse(RepoRemoteBranchesResponseSchema, [])).toEqual([])
    expect(v.parse(RepoLogResponseSchema, [])).toEqual([])
    expect(
      v.parse(RepoSnapshotResponseSchema, {
        snapshot: {
          branches: [],
          worktrees: [],
          current: 'main',
          remote: {
            remotes: [],
            hasRemotes: false,
            hasBrowserRemote: false,
            remoteProviders: {},
            hasGitHubRemote: false,
          },
        },
      }),
    ).toMatchObject({ snapshot: { current: 'main', branches: [] } })
    expect(v.parse(RepoPullRequestsResponseSchema, { pullRequests: null })).toEqual({ pullRequests: null })
  })

  test.each([40, 64])('accepts a repository log entry with a %i-character object id', (length) => {
    const entry = {
      hash: 'a'.repeat(length),
      shortHash: 'aaaaaaa',
      refs: 'HEAD -> main',
      message: 'Initial commit',
      author: 'Example Author',
      date: '2026-01-01T00:00:00.000Z',
    }

    expect(v.parse(RepoLogResponseSchema, [entry])).toEqual([entry])
  })

  test('rejects malformed, forward-incompatible, and full-read-model mutation envelopes', () => {
    expect(
      v.parse(RepoMutationExecResultResponseSchema, {
        ok: false,
        message: 'upstream deletion failed',
        recoveryMessageKeys: ['error.local-branch-deleted-followup-failed'],
      }),
    ).toEqual({
      ok: false,
      message: 'upstream deletion failed',
      recoveryMessageKeys: ['error.local-branch-deleted-followup-failed'],
    })
    expect(v.safeParse(ExecResultResponseSchema, { ok: true }).success).toBe(false)
    expect(
      v.safeParse(ExecResultResponseSchema, {
        ok: false,
        message: 'failed',
        recoveryMessageKeys: ['error.worktree-created-followup-failed'],
      }).success,
    ).toBe(false)
    expect(v.safeParse(ExecResultResponseSchema, { ok: true, message: 'ok', legacy: true }).success).toBe(false)
    expect(v.safeParse(ExecResultResponseSchema, { ok: true, message: 'ok', snapshot: {} }).success).toBe(false)
    expect(
      v.safeParse(RepoMutationExecResultResponseSchema, {
        ok: false,
        message: 'failed',
        recoveryMessageKeys: [
          'error.worktree-created-followup-failed',
          'error.worktree-removed-followup-failed',
          'error.local-branch-deleted-followup-failed',
          'error.worktree-created-followup-failed',
        ],
      }).success,
    ).toBe(false)
  })

  test('requires a canonical path only for successful worktree creation', () => {
    expect(
      v.parse(CreateWorktreeExecResultResponseSchema, {
        ok: true,
        message: 'ok',
        worktreePath: '/tmp/repo-worktree',
      }),
    ).toEqual({ ok: true, message: 'ok', worktreePath: '/tmp/repo-worktree' })
    expect(v.safeParse(CreateWorktreeExecResultResponseSchema, { ok: true, message: 'ok' }).success).toBe(false)
    expect(
      v.safeParse(CreateWorktreeExecResultResponseSchema, {
        ok: false,
        message: 'failed',
        worktreePath: '/tmp/repo-worktree',
      }).success,
    ).toBe(false)
  })

  test('rejects a malformed member instead of turning a list into an empty result', () => {
    expect(v.safeParse(RepoRemoteBranchesResponseSchema, ['origin/main', 42]).success).toBe(false)
    expect(v.safeParse(RepoLogResponseSchema, [{ hash: 'abc' }]).success).toBe(false)
    expect(
      v.safeParse(RepoLogResponseSchema, [
        {
          hash: 'abcdef1',
          shortHash: 'abcdef1',
          refs: '',
          message: 'message',
          author: 'Example Author',
          date: '2026-01-01T00:00:00.000Z',
        },
      ]).success,
    ).toBe(false)
  })

  test('rejects legacy and partial repository snapshot shapes', () => {
    const branch = {
      name: 'main',
      ahead: 0,
      behind: 0,
      lastCommitHash: 'abcdef1234567890abcdef1234567890abcdef12',
      lastCommitShortHash: 'abcdef1',
      lastCommitMessage: 'Initial commit',
      lastCommitDate: '2026-01-01T00:00:00.000Z',
      lastCommitAuthor: 'Example Author',
      worktree: { path: '/workspace', isPrimary: true, isLocked: false },
    }
    const remote = {
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      remoteProviders: {},
      hasGitHubRemote: false,
    }
    expect(v.safeParse(RepoSnapshotResponseSchema, { snapshot: { branches: [branch], current: 'main' } }).success).toBe(
      false,
    )
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: { branches: [branch], worktrees: [], current: 'main', remote },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: {
          branches: [{ ...branch, worktree: { path: '/workspace', isLocked: false } }],
          current: 'main',
          remote,
        },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: {
          branches: [{ ...branch, worktree: { path: '/workspace', isPrimary: true } }],
          current: 'main',
          remote,
        },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: {
          branches: [
            { ...branch, pullRequest: { number: 1, title: 'Legacy', url: 'https://example.invalid/1', state: 'open' } },
          ],
          current: 'main',
          remote,
        },
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: { branches: [branch], current: 'main', remote },
        loadedAt: 1,
      }).success,
    ).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: { branches: [], worktrees: [], current: '', currentHEAD: 'abcdef1', remote },
      }).success,
    ).toBe(false)
  })

  test('rejects invalid worktree branch ownership', () => {
    const branch = {
      name: 'main',
      ahead: 0,
      behind: 0,
      lastCommitHash: 'abcdef1234567890abcdef1234567890abcdef12',
      lastCommitShortHash: 'abcdef1',
      lastCommitMessage: 'Initial commit',
      lastCommitDate: '2026-01-01T00:00:00.000Z',
      lastCommitAuthor: 'Example Author',
    }
    const remote = {
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      remoteProviders: {},
      hasGitHubRemote: false,
    }
    const worktree = {
      path: '/workspace',
      head: { kind: 'branch' as const, branchName: 'main' },
      headOid: 'abcdef1234567890abcdef1234567890abcdef12',
      operation: null,
      materializedBranch: 'main',
      isPrimary: true,
      isLocked: false,
    }
    const parses = (worktrees: unknown[], branches: unknown[] = [branch]) =>
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: { branches, worktrees, current: 'main', remote },
      }).success

    expect(parses([worktree])).toBe(true)
    expect(parses([worktree], [{ ...branch, isCurrent: true }])).toBe(false)
    expect(parses([{ ...worktree, headOid: 'a'.repeat(64) }])).toBe(true)
    expect(parses([{ ...worktree, headOid: null }], [])).toBe(true)
    expect(parses([{ ...worktree, headOid: null }], [{ ...branch, name: 'other' }])).toBe(true)
    expect(parses([{ ...worktree, headOid: null }])).toBe(false)
    expect(parses([{ ...worktree, headOid: '0'.repeat(40) }])).toBe(false)
    expect(parses([{ ...worktree, headOid: '0'.repeat(64) }])).toBe(false)
    expect(parses([{ ...worktree, headOid: 'abcdef1' }])).toBe(false)
    expect(parses([{ ...worktree, headOid: 'not-an-object-id' }])).toBe(false)
    expect(parses([{ ...worktree, head: { kind: 'detached' }, headOid: null, materializedBranch: null }])).toBe(false)
    expect(parses([{ ...worktree, headOid: null, operation: { kind: 'bisect' } }])).toBe(false)
    expect(parses([{ ...worktree, materializedBranch: null }])).toBe(false)
    expect(parses([{ ...worktree, materializedBranch: 'other' }])).toBe(false)
    expect(parses([{ ...worktree, operation: { kind: 'rebase' } }])).toBe(false)
    expect(parses([{ ...worktree, operation: { kind: 'bisect' } }])).toBe(true)
    expect(parses([worktree], [branch, { ...branch }])).toBe(false)
    expect(
      parses([
        worktree,
        {
          ...worktree,
          path: '/workspace/other',
          head: { kind: 'detached' },
          operation: { kind: 'merge' },
          materializedBranch: null,
          isPrimary: true,
        },
      ]),
    ).toBe(false)
    expect(parses([worktree], [{ ...branch, name: 'unsafe branch' }])).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: { branches: [branch], worktrees: [worktree], current: 'unsafe branch', remote },
      }).success,
    ).toBe(false)
    expect(parses([{ ...worktree, head: { kind: 'detached' }, operation: null }])).toBe(false)
    expect(
      v.safeParse(RepoSnapshotResponseSchema, {
        snapshot: {
          branches: [{ ...branch, lastCommitHash: 'abcdef1' }],
          worktrees: [worktree],
          current: 'main',
          remote,
        },
      }).success,
    ).toBe(false)
    expect(parses([{ ...worktree, head: { kind: 'detached' }, materializedBranch: 'unsafe branch' }])).toBe(false)
    expect(
      parses([
        { ...worktree, head: { kind: 'detached' }, operation: { kind: 'rebase' }, materializedBranch: 'missing' },
      ]),
    ).toBe(false)
    expect(
      parses([
        worktree,
        { ...worktree, path: '/workspace/linked', head: { kind: 'detached' }, materializedBranch: 'main' },
      ]),
    ).toBe(false)
    expect(
      parses([
        worktree,
        {
          ...worktree,
          head: { kind: 'detached' },
          operation: { kind: 'merge' },
          materializedBranch: null,
          isPrimary: false,
        },
      ]),
    ).toBe(false)
  })

  test('rejects extra pull-request response fields', () => {
    expect(v.safeParse(RepoPullRequestsResponseSchema, { pullRequests: [], requested: ['main'] }).success).toBe(false)
  })
})
