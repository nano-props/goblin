import { describe, expect, test } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import type * as RepoWritePaths from '#/server/modules/repo-write-paths.ts'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import {
  LINKED_REPO_ID,
  REPO_ID,
  WORKTREE_BOOTSTRAP_CONFIG_HASH,
  WORKTREE_REPO_ID,
  createLocalRepoWorktreeWithBootstrap,
  mocks,
} from '#/server/test-utils/repo-module.ts'

describe('repo branch mutations', () => {
  test('deleteRepoBranch settles the write operation and returns its projection impact', async () => {
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')
    const { listRepoWriteOperationsForRepo } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: true, message: 'ok', repoIdsToInvalidate: [REPO_ID] })
    await expect(listRepoWriteOperationsForRepo(REPO_ID, { includeSettled: true })).resolves.toMatchObject([
      { phase: 'done' },
    ])
  })

  test.each([
    ['pullRepoBranch', async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a')],
    ['pushRepoBranch', async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a')],
  ])('%s records the network mutation in the repo write coordinator', async (name, run) => {
    const repo = await import('#/server/modules/repo-write-paths.ts')
    const { listRepoWriteOperationsForRepo } = await import('#/server/modules/repo-write-operation-coordinator.ts')

    const result = await run(repo)

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(name === 'pullRepoBranch' ? mocks.pullBranch : mocks.pushBranch).toHaveBeenCalled()
    await expect(listRepoWriteOperationsForRepo(REPO_ID, { includeSettled: true })).resolves.toMatchObject(
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
    mocks.pullBranch.mockResolvedValueOnce(
      commandOutcomeForTest({
        ok: true,
        message: 'ok',
        worktreePathsToInvalidate: ['/tmp/repo-worktree'],
      }),
    )
    const { pullRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await pullRepoBranch(REPO_ID, 'feature/a', '/tmp/repo-worktree')

    expect(result).toMatchObject({
      ok: true,
      message: 'ok',
      worktreePathsToInvalidate: ['/tmp/repo-worktree'],
    })
  })

  test('pullRepoBranch publishes invalidation when failure may follow partial ref updates', async () => {
    mocks.pullBranch.mockResolvedValueOnce(
      commandOutcomeForTest(
        { ok: false, message: 'fatal: pull failed', worktreePathsToInvalidate: ['/tmp/repo'] },
        'failed',
      ),
    )
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await repo.pullRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'fatal: pull failed' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
    expect(result.worktreePathsToInvalidate).toEqual(['/tmp/repo'])
  })

  test.each([
    [
      'pullRepoBranch',
      () =>
        mocks.pullBranch.mockResolvedValueOnce(
          commandOutcomeForTest({ ok: false, message: 'git timed out after 90s' }, 'timed-out'),
        ),
      async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a'),
    ],
    [
      'pushRepoBranch',
      () =>
        mocks.pushBranch.mockResolvedValueOnce(
          commandOutcomeForTest({ ok: false, message: 'git timed out after 90s' }, 'timed-out'),
        ),
      async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a'),
    ],
  ])('%s reports an uncertain result after timeout', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result).toMatchObject({ ok: false, message: 'error.git-command-timeout-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test.each([
    [
      'pullRepoBranch',
      () =>
        mocks.pullBranch.mockResolvedValueOnce(
          commandOutcomeForTest({ ok: false, message: 'fatal: pull failed' }, 'not-started'),
        ),
      async (repo: typeof RepoWritePaths) => repo.pullRepoBranch(REPO_ID, 'feature/a'),
    ],
    [
      'pushRepoBranch',
      () =>
        mocks.pushBranch.mockResolvedValueOnce(
          commandOutcomeForTest({ ok: false, message: 'fatal: push failed' }, 'not-started'),
        ),
      async (repo: typeof RepoWritePaths) => repo.pushRepoBranch(REPO_ID, 'feature/a'),
    ],
    [
      'createRepoWorktree',
      () =>
        mocks.createWorktree.mockResolvedValueOnce(
          commandOutcomeForTest({ ok: false, message: 'fatal: worktree failed' }, 'not-started'),
        ),
      async (repo: typeof RepoWritePaths) =>
        repo.createRepoWorktree(REPO_ID, {
          worktreePath: '/tmp/repo-worktree',
          mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
        }),
    ],
  ])('%s does not publish snapshot invalidation after failure', async (_name, setup, run) => {
    setup()
    const repo = await import('#/server/modules/repo-write-paths.ts')

    const result = await run(repo)

    expect(result.repoIdsToInvalidate).toBeUndefined()
  })

  test('pushRepoBranch invalidates repository projections when a failed command may have run', async () => {
    mocks.pushBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'fatal: push failed' }, 'failed'),
    )
    const { pushRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await pushRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'fatal: push failed' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('pushRepoBranch invalidates remote projections when a failed SSH command ran remotely', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValueOnce(['/srv/repo', '/srv/repo-feature'])
    mocks.pushRemoteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'connection closed after push' }, 'failed'),
    )
    const { pushRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await pushRepoBranch(repoId, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'connection closed after push' })
    expect(result.repoIdsToInvalidate).toEqual([repoId, linkedRepoId])
  })

  test('publishes primary SSH mutation impact before the runtime transport failure escapes', async () => {
    const [{ RepoMutationRuntimeFailureError }, { RemoteWorkspaceRuntimeFailureError }, { pushRepoBranch }] =
      await Promise.all([
        import('#/server/modules/repo-mutation-runtime-failure.ts'),
        import('#/server/modules/remote-workspace-runtime-failure.ts'),
        import('#/server/modules/repo-write-paths.ts'),
      ])
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: repoId,
      workspaceRuntimeId: 'runtime-test',
      reason: 'unreachable',
      message: 'connection lost',
    })
    mocks.pushRemoteBranch.mockRejectedValueOnce(
      new RepoMutationRuntimeFailureError(
        {
          ok: false,
          message: 'connection lost',
          repoIdsToInvalidate: [repoId, linkedRepoId],
        },
        runtimeFailure,
      ),
    )
    await expect(
      pushRepoBranch(repoId, 'feature/a', undefined, { workspaceRuntimeId: 'runtime-test' }),
    ).rejects.toMatchObject({ runtimeFailure, mutation: { repoIdsToInvalidate: [repoId, linkedRepoId] } })
  })

  test('propagates mutation impact from a preclassified SSH branch runtime carrier', async () => {
    const [{ RepoMutationRuntimeFailureError }, { RemoteWorkspaceRuntimeFailureError }, { deleteRepoBranch }] =
      await Promise.all([
        import('#/server/modules/repo-mutation-runtime-failure.ts'),
        import('#/server/modules/remote-workspace-runtime-failure.ts'),
        import('#/server/modules/repo-write-paths.ts'),
      ])
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: repoId,
      workspaceRuntimeId: 'runtime-test',
      reason: 'unreachable',
      message: 'upstream connection lost',
    })
    mocks.deleteRemoteBranch.mockRejectedValueOnce(
      new RepoMutationRuntimeFailureError(
        {
          ok: false,
          message: 'upstream connection lost',
          repoIdsToInvalidate: [repoId, linkedRepoId],
        },
        runtimeFailure,
      ),
    )
    await expect(
      deleteRepoBranch(repoId, 'feature/a', { deleteUpstream: true }, undefined, {
        workspaceRuntimeId: 'runtime-test',
      }),
    ).rejects.toMatchObject({ runtimeFailure, mutation: { repoIdsToInvalidate: [repoId, linkedRepoId] } })
  })

  test('createRepoWorktree invalidates source and target projections when a failed command may have run', async () => {
    mocks.createWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'fatal: worktree failed' }, 'failed'),
    )
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: '/tmp/repo-worktree',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: false, message: 'fatal: worktree failed' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, WORKTREE_REPO_ID])
  })

  test('createRepoWorktree publishes invalidation when bootstrap fails after git created the worktree', async () => {
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      worktreeBootstrap: {
        copy: { count: 1, paths: ['first.env'] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 0, paths: [] },
      },
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toMatchObject({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
      worktreeBootstrap: {
        copy: { count: 1, paths: ['first.env'] },
        symlink: { count: 0, paths: [] },
        hardlink: { count: 0, paths: [] },
        skippedMissing: { count: 0, paths: [] },
      },
    })
    expect(mocks.bootstrapWorktreeAfterCreate).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', {
      signal: undefined,
      expectedConfigHash: WORKTREE_BOOTSTRAP_CONFIG_HASH,
    })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, WORKTREE_REPO_ID])
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).not.toHaveBeenCalled()
  })

  test('createRepoWorktree surfaces recovery when bootstrap is cancelled after creation', async () => {
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({ ok: false, message: 'cancelled' })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: false })

    expect(result).toMatchObject({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, WORKTREE_REPO_ID])
  })

  test('createRepoWorktree publishes remote invalidation when bootstrap fails after remote worktree creation', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const worktreeRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.createRemoteWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({
        ok: true,
        message: 'created',
        worktreePathsToInvalidate: ['/srv/repo-feature'],
      }),
    )
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

    expect(result).toMatchObject({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(result.repoIdsToInvalidate).toEqual([repoId, worktreeRepoId])
  })

  test('createRepoWorktree surfaces recovery when remote bootstrap is cancelled after creation', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const worktreeRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.createRemoteWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({
        ok: true,
        message: 'created',
        worktreePathsToInvalidate: ['/srv/repo-feature'],
      }),
    )
    mocks.bootstrapRemoteWorktreeAfterCreate.mockResolvedValueOnce({ ok: false, message: 'cancelled' })
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

    expect(result).toMatchObject({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(result.repoIdsToInvalidate).toEqual([repoId, worktreeRepoId])
  })

  test('createRepoWorktree invalidates the remote source and target after a started SSH timeout', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const worktreeRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.createRemoteWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'error.worktree-create-timeout-check-state' }, 'timed-out'),
    )
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(repoId, {
      worktreePath: '/srv/repo-feature',
      mode: { kind: 'existingBranch', branch: 'feature/a' },
    })

    expect(result).toMatchObject({ ok: false, message: 'error.worktree-create-timeout-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([repoId, worktreeRepoId])
    expect(mocks.bootstrapRemoteWorktreeAfterCreate).not.toHaveBeenCalled()
  })

  test('createRepoWorktree does not store bootstrap trust when bootstrap fails', async () => {
    mocks.bootstrapWorktreeAfterCreate.mockResolvedValueOnce({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
    })
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createLocalRepoWorktreeWithBootstrap(createRepoWorktree, { configTrusted: true })

    expect(result).toMatchObject({
      ok: false,
      message: 'Worktree bootstrap failed: destination already exists: .env.local',
      recoveryMessageKeys: ['error.worktree-created-followup-failed'],
    })
    expect(mocks.setServerWorkspaceWorktreeBootstrapConfigTrust).not.toHaveBeenCalled()
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('createRepoWorktree rejects non-absolute paths before calling git', async () => {
    const { createRepoWorktree } = await import('#/server/modules/repo-write-paths.ts')

    const result = await createRepoWorktree(REPO_ID, {
      worktreePath: 'relative/path',
      mode: { kind: 'newBranch', newBranch: 'feature/a', baseRef: 'main' },
    })

    expect(result).toMatchObject({ ok: false, message: 'error.invalid-path' })
    expect(mocks.createWorktree).not.toHaveBeenCalled()
    expect(result.repoIdsToInvalidate).toBeUndefined()
  })

  test('deleteRepoBranch publishes snapshot invalidation after success', async () => {
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual([])
    expect((await readRepoOperationsSnapshot(REPO_ID, { includeSettled: true })).operations[0]).toMatchObject({
      kind: 'delete-branch',
      phase: 'done',
      target: { branch: 'feature/a' },
    })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('remote deleteRepoBranch forwards upstream deletion and refreshes affected remote worktrees after partial failure', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-linked' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValueOnce(['/srv/repo', '/srv/repo-linked'])
    mocks.deleteRemoteBranch.mockResolvedValueOnce({
      ok: false,
      message: 'cancelled',
      branchEffect: 'local-delete-confirmed',
    })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(repoId, 'feature/a', { deleteUpstream: true })

    expect(result).toMatchObject({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.local-branch-deleted-followup-failed'],
    })
    expect(mocks.deleteRemoteBranch).toHaveBeenCalledWith(
      expect.objectContaining({ remotePath: '/srv/repo' }),
      expect.objectContaining({
        branch: 'feature/a',
        force: undefined,
        deleteUpstream: true,
        signal: undefined,
      }),
    )
    expect(result.repoIdsToInvalidate).toEqual([repoId, linkedRepoId])
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID, LINKED_REPO_ID])
  })

  test('deleteRepoBranch refuses protected branches before touching git', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('feature/current')
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'main')

    expect(result).toMatchObject({ ok: false, message: 'error.cannot-delete-protected-branch' })
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expect(result.repoIdsToInvalidate).toBeUndefined()
  })

  test('deleteRepoBranch uses current HEAD semantics for safe deletes', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.isAncestor.mockImplementationOnce(async (_cwd, _branch, descendant) => descendant === 'release/1.0')
    mocks.getUpstream.mockResolvedValueOnce(null)
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: true, message: 'ok' })
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

    expect(result).toMatchObject({ ok: false, message: 'error.branch-not-fully-merged' })
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.getUpstream).toHaveBeenCalledTimes(1)
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'refs/remotes/origin/feature/a', undefined)
    expect(mocks.deleteUpstreamBranch).toHaveBeenCalledWith('/tmp/repo', 'origin', 'feature/a', undefined)
  })

  test('deleteRepoBranch invalidates metadata when local deletion succeeded before upstream cancellation', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: 'refs/remotes/origin/feature/a',
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    mocks.deleteUpstreamBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'not-started'),
    )
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a', { deleteUpstream: true })

    expect(result).toMatchObject({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.local-branch-deleted-followup-failed'],
    })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
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

    await expect(deleteRepoBranch(REPO_ID, 'feature/a', { deleteUpstream: true })).resolves.toMatchObject({
      ok: true,
      message: 'ok',
    })
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'refs/heads/main', undefined)
    expect(mocks.deleteUpstreamBranch).not.toHaveBeenCalled()
  })

  test('deleteRepoBranch does not publish snapshot invalidation after failure', async () => {
    mocks.deleteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'fatal: delete failed' }, 'not-started'),
    )
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result.repoIdsToInvalidate).toBeUndefined()
  })

  test('deleteRepoBranch reports uncertainty and invalidates when the delete command may have run', async () => {
    mocks.deleteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'connection closed' }, 'failed'),
    )
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'connection closed' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('deleteRepoBranch surfaces cancellation after the delete command started', async () => {
    mocks.deleteBranch.mockResolvedValueOnce(commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'cancelled'))
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'error.git-command-cancelled-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('deleteRepoBranch reports an uncertain result after timeout', async () => {
    mocks.deleteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'git timed out after 180s' }, 'timed-out'),
    )
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'error.git-command-timeout-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('deleteRepoBranch reports uncertain upstream timeout after confirmed local deletion', async () => {
    mocks.getCurrentBranch.mockResolvedValueOnce('release/1.0')
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: 'refs/remotes/origin/feature/a',
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    mocks.deleteUpstreamBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'upstream timeout' }, 'timed-out'),
    )
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a', { deleteUpstream: true })

    expect(result).toMatchObject({
      ok: false,
      message: 'error.git-command-timeout-check-state',
      recoveryMessageKeys: ['error.local-branch-deleted-followup-failed'],
    })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })

  test('remote deleteRepoBranch classifies timeout at the server domain boundary', async () => {
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    mocks.getRemoteRepoWorktreePaths.mockResolvedValueOnce(['/srv/repo'])
    mocks.deleteRemoteBranch.mockResolvedValueOnce({
      ok: false,
      message: 'timeout',
      branchEffect: 'may-have-changed',
      failureExecution: { status: 'timed-out' },
    })
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(repoId, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'error.git-command-timeout-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([repoId])
  })

  test('deleteRepoBranch preserves an ordinary Git error while conservatively invalidating', async () => {
    mocks.deleteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'error: branch is not fully merged' }, 'failed'),
    )
    const { deleteRepoBranch } = await import('#/server/modules/repo-write-paths.ts')

    const result = await deleteRepoBranch(REPO_ID, 'feature/a')

    expect(result).toMatchObject({ ok: false, message: 'error: branch is not fully merged' })
    expect(result.repoIdsToInvalidate).toEqual([REPO_ID])
  })
})
