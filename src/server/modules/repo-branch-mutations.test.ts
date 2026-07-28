import { describe, expect, test } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type * as RepoWritePaths from '#/server/modules/repo-write-paths.ts'
import {
  LINKED_REPO_ID,
  REPO_ID,
  WORKTREE_BOOTSTRAP_CONFIG_HASH,
  WORKTREE_REPO_ID,
  createLocalRepoWorktreeWithBootstrap,
  expectNoRepoSnapshotInvalidations,
  expectRepoSnapshotInvalidations,
  repoWorktreeSnapshotInvalidations,
  mocks,
} from '#/server/test-utils/repo-module.ts'

describe('repo branch mutations', () => {
  test.each([
    ['pullRepoBranch', async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a')],
    ['pushRepoBranch', async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a')],
  ])('%s records the network mutation in the repo write coordinator', async (name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')
    const { listRepoWriteOperationsForRepo } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(name === 'pullRepoBranch' ? mocks.pullBranch : mocks.pushBranch).toHaveBeenCalled()
    await expect(listRepoWriteOperationsForRepo(REPO_ID, { includeSettled: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^repo-write-op-/),
          kind: name === 'pullRepoBranch' ? 'pull' : 'push',
          phase: 'done',
          source: 'user',
          target: expect.objectContaining({ branch: 'feature/a' }),
        }),
      ]),
    )
  })

  test('pullRepoBranch preserves the authoritative changed worktree paths for route projection', async () => {
    mocks.pullBranch.mockResolvedValueOnce({
      ok: true,
      message: 'ok',
      affectedWorktreePaths: ['/tmp/repo-worktree'],
    })
    const { pullRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await pullRepoBranch(REPO_ID, 'feature/a', '/tmp/repo-worktree')

    expect(result).toEqual({
      ok: true,
      message: 'ok',
      affectedWorktreePaths: ['/tmp/repo-worktree'],
    })
  })

  test('pullRepoBranch publishes invalidation when failure may follow partial ref updates', async () => {
    mocks.pullBranch.mockResolvedValueOnce({
      ok: false,
      message: 'fatal: pull failed',
      repositoryStateChanged: true,
      affectedWorktreePaths: ['/tmp/repo'],
    })
    const repo = await import('#/server/modules/repo-write-paths.ts')

    await repo.pullRepoBranch(REPO_ID, 'feature/a')

    expectRepoSnapshotInvalidations({ repoId: REPO_ID, query: 'repo-snapshot' })
    expect(repoWorktreeSnapshotInvalidations()).toEqual([{ repoId: REPO_ID, query: 'repo-worktree-snapshot' }])
  })

  test.each([
    [
      'pullRepoBranch',
      () => mocks.pullBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: pull failed' }),
      async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a'),
    ],
    [
      'pushRepoBranch',
      () => mocks.pushBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: push failed' }),
      async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a'),
    ],
    [
      'createRepoWorktree',
      () => mocks.createWorktree.mockResolvedValueOnce({ ok: false, message: 'fatal: worktree failed' }),
      async (repo: typeof RepoWritePaths) =>
        repo.createRepoWorktree(REPO_ID, {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s does not publish snapshot invalidation after failure', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo-write-paths.ts')

    await run(repo)

    expectNoRepoSnapshotInvalidations()
  })

  test('createRepoWorktree publishes invalidation when bootstrap fails after git created the worktree', async () => {
    mocks.getServerWorkspaceSettings.mockResolvedValueOnce([
      {
        repoId: REPO_ID,
        worktreeBootstrapTrust: {
          configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
          trustedAt: '2026-06-26T00:00:00.000Z',
        },
      },
    ])
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      repositoryStateChanged: true,
    })
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: REPO_ID,
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: WORKTREE_REPO_ID,
      query: 'repo-snapshot',
    })
    expect(mocks.untrustServerWorkspaceWorktreeBootstrapConfig).not.toHaveBeenCalled()
  })

  test('createRepoWorktree publishes remote invalidation when bootstrap fails after remote worktree creation', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const worktreeRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.createRemoteWorktree.mockResolvedValueOnce({
      ok: true,
      message: 'created',
      affectedWorktreePaths: ['/srv/repo-feature'],
    })
    mocks.bootstrapRemoteWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(
      repoId,
      {
        worktreePath: '/srv/repo-feature',
        mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
      },
      undefined,
      {
        worktreeBootstrap: {
          kind: 'run',
          configHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
          configTrusted: false,
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      repositoryStateChanged: true,
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId,
      query: 'repo-snapshot',
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: worktreeRepoId,
      query: 'repo-snapshot',
    })
  })

  test('createRepoWorktree does not store bootstrap trust when bootstrap fails', async () => {
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: true })

    expect(result).toEqual({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      repositoryStateChanged: true,
    })
    expect(mocks.trustServerWorkspaceWorktreeBootstrapConfig).not.toHaveBeenCalled()
    expect(mocks.untrustServerWorkspaceWorktreeBootstrapConfig).not.toHaveBeenCalled()
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('createRepoWorktree rejects non-absolute paths before calling git', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toEqual({ ok: false, message: 'error.invalid-path' })
    expect(mocks.createWorktree).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('deleteRepoBranch publishes snapshot invalidation after success', async () => {
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual([])
    expect((await readRepoOperationsSnapshot(REPO_ID, { includeSettled: true })).operations[0]).toMatchObject({
      kind: 'delete-branch',
      phase: 'done',
      target: { branch: 'feature/a' },
    })
    expect(mocks.publishRepoQueryInvalidation).toHaveBeenCalledWith({
      repoId: REPO_ID,
      query: 'repo-snapshot',
    })
  })

  test('remote deleteRepoBranch forwards upstream deletion and refreshes affected remote worktrees after partial failure', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValueOnce(['/srv/repo', '/srv/repo-linked'])
    mocks.deleteRemoteBranch.mockResolvedValueOnce({
      ok: false,
      message: 'remote rejected delete',
      repositoryStateChanged: true,
    })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(repoId, 'feature/a', { deleteUpstream: true })

    expect(result).toEqual({ ok: false, message: 'remote rejected delete', repositoryStateChanged: true })
    expect(mocks.deleteRemoteBranch).toHaveBeenCalledWith(expect.objectContaining({ remotePath: '/srv/repo' }), {
      branch: 'feature/a',
      force: undefined,
      deleteUpstream: true,
      signal: undefined,
    })
    expectRepoSnapshotInvalidations(
      {
        repoId,
        query: 'repo-snapshot',
      },
      {
        repoId: linkedRepoId,
        query: 'repo-snapshot',
      },
    )
  })

  test.each([
    ['pullRepoBranch', async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a')],
    ['pushRepoBranch', async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a')],
    ['deleteRepoBranch', async (repo: typeof RepoWritePaths) => repo.deleteRepoBranch(REPO_ID, 'feature/a')],
  ])('%s publishes sibling worktree snapshot invalidations after success', async (_name, run) => {
    mocks.readWorktreeMembership.mockResolvedValue([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-linked', branch: 'feature/b', isBare: false, isPrimary: false },
    ])
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expectRepoSnapshotInvalidations(
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: LINKED_REPO_ID,
        query: 'repo-snapshot',
      },
    )
  })

  test('deleteRepoBranch refuses protected branches before touching git', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('feature/current')
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'main')

    expect(result).toEqual({ ok: false, message: 'error.cannot-delete-protected-branch' })
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('deleteRepoBranch uses current HEAD semantics for safe deletes', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.isAncestor.mockImplementationOnce(async (_cwd, _branch, descendant) => descendant === 'release/1.0')
    mocks.getUpstream.mockResolvedValueOnce(null)
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'release/1.0', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
  })

  test('deleteRepoBranch treats a configured but missing tracking ref as unavailable for merge safety', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.isAncestor.mockResolvedValueOnce(false)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: null,
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toEqual({ ok: false, message: 'error.branch-not-fully-merged' })
    expect(mocks.isAncestor).toHaveBeenCalledOnce()
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'release/1.0', undefined)
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
  })

  test('deleteRepoBranch freezes one upstream read across validation and deletion', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream
      .mockResolvedValueOnce({
        ancestryRef: 'refs/remotes/origin/feature/a',
        source: { remote: 'origin', branch: 'feature/a' },
        deleteTarget: { remote: 'origin', branch: 'feature/a' },
      })
      .mockResolvedValueOnce({
        ancestryRef: 'refs/remotes/fork/other',
        source: { remote: 'fork', branch: 'other' },
        deleteTarget: { remote: 'fork', branch: 'other' },
      })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a', { deleteUpstream: true })

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.getUpstream).toHaveBeenCalledTimes(1)
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'refs/remotes/origin/feature/a', undefined)
    expect(mocks.deleteUpstreamBranch).toHaveBeenCalledWith('/tmp/repo', 'origin', 'feature/a', undefined)
  })

  test('uses a local upstream for merge safety without attempting remote deletion', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: 'refs/heads/main',
      source: { remote: '.', branch: 'main' },
      deleteTarget: null,
    })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    await expect(deleteRepoBranch(REPO_ID, 'feature/a', { deleteUpstream: true })).resolves.toEqual({
      ok: true,
      message: 'ok',
    })
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'refs/heads/main', undefined)
    expect(mocks.deleteUpstreamBranch).not.toHaveBeenCalled()
  })

  test('deleteRepoBranch does not publish snapshot invalidation after failure', async () => {
    mocks.deleteBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: delete failed' })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    await deleteRepoBranch(REPO_ID, 'feature/a')

    expectNoRepoSnapshotInvalidations()
  })
})
