import { describe, expect, test } from 'vitest'
import * as v from 'valibot'
import { ExecResultResponseSchema } from '#/shared/http-response-schema.ts'
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

  test('rejects malformed, forward-incompatible, and full-read-model mutation envelopes', () => {
    expect(v.safeParse(ExecResultResponseSchema, { ok: true }).success).toBe(false)
    expect(v.safeParse(ExecResultResponseSchema, { ok: true, message: 'ok', legacy: true }).success).toBe(false)
    expect(v.safeParse(ExecResultResponseSchema, { ok: true, message: 'ok', snapshot: {} }).success).toBe(false)
  })

  test('rejects a malformed member instead of turning a list into an empty result', () => {
    expect(v.safeParse(RepoRemoteBranchesResponseSchema, ['origin/main', 42]).success).toBe(false)
    expect(v.safeParse(RepoLogResponseSchema, [{ hash: 'abc' }]).success).toBe(false)
  })

  test('rejects legacy and partial repository snapshot shapes', () => {
    const branch = {
      name: 'main',
      isCurrent: true,
      ahead: 0,
      behind: 0,
      lastCommitHash: 'abcdef1234567890',
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
  })

  test('rejects extra pull-request response fields', () => {
    expect(v.safeParse(RepoPullRequestsResponseSchema, { pullRequests: [], requested: ['main'] }).success).toBe(false)
  })
})
