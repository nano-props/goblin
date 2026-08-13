import { describe, expect, test } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  REPO_ID,
  expectNoRepoMetadataInvalidations,
  mocks,
  pullRequest,
  repoSnapshot,
} from '#/server/test-utils/repo-module.ts'
import { repoRuntimeCapabilityForTest } from '#/server/test-utils/repo-module.ts'

describe('resolveRemoteWorkspaceTarget', () => {
  test('threads cancellation into SSH config resolution', async () => {
    const signal = new AbortController().signal
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const { resolveRemoteWorkspaceTarget } = await import('#/server/modules/remote-repo-execution.ts')

    await resolveRemoteWorkspaceTarget(repoId, { workspaceRuntimeId: 'runtime-test' }, signal)

    expect(mocks.resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' }, signal)
  })
})

describe('getRepoSnapshot', () => {
  test('rejects a snapshot while worktree membership is changing', async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const { enqueueRepoWriteOperation } = await import('#/server/modules/repo-write-operation-coordinator.ts')
    const write = enqueueRepoWriteOperation(
      REPO_ID,
      undefined,
      {
        runtimeCapability: repoRuntimeCapabilityForTest(REPO_ID, 'test-runtime'),
        repoId: REPO_ID,
        kind: 'create-worktree',
        source: 'user',
        target: { branch: 'feature/creating', worktreePath: '/tmp/repo-creating' },
      },
      (operation) => async () => {
        operation.start()
        await operation.runMembershipMutation(async () => {
          started.resolve()
          await release.promise
        })
        operation.settle({ ok: true })
        return { ok: true, message: 'created' }
      },
    )
    await started.promise
    try {
      const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
      await expect(getRepoSnapshot(REPO_ID)).rejects.toThrow('error.repo-membership-changing')
      expect(mocks.readWorktreeMembership).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await write
    }
  })

  test('reads git state directly without publishing invalidation', async () => {
    const snapshot = repoSnapshot('fresh')
    const membership = [
      {
        path: '/tmp/repo',
        branch: snapshot.current,
        headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        isBare: false,
        isPrimary: true,
      },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(membership)
    mocks.getBranches.mockResolvedValueOnce(snapshot.branches)
    mocks.getRemoteInfo.mockResolvedValueOnce(snapshot.remote)

    const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoSnapshot(REPO_ID)

    expect(result).toEqual({
      ...snapshot,
      worktrees: [
        {
          path: '/tmp/repo',
          head: { kind: 'branch', branchName: 'fresh' },
          headOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          operation: null,
          materializedBranch: 'fresh',
          isPrimary: true,
          isLocked: false,
        },
      ],
    })
    expect(mocks.getCurrentBranch).not.toHaveBeenCalled()
    expectNoRepoMetadataInvalidations()
  })

  test('rejects an authoritative snapshot when branch membership cannot be read', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.getBranches.mockRejectedValueOnce(new Error('git unavailable'))

    const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepoSnapshot(REPO_ID)).rejects.toThrow('git unavailable')
    expect(mocks.getRemoteInfo).not.toHaveBeenCalled()
  })

  test('reads current from symbolic HEAD only for a bare source workspace', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([{ path: '/tmp/repo', isBare: true, isPrimary: true }])
    mocks.getBranches.mockResolvedValueOnce([])
    mocks.getCurrentBranch.mockResolvedValueOnce('bare/main')
    mocks.getRemoteInfo.mockResolvedValueOnce(repoSnapshot().remote)

    const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    await expect(getRepoSnapshot(REPO_ID)).resolves.toMatchObject({ current: 'bare/main', worktrees: [] })

    expect(mocks.getCurrentBranch).toHaveBeenCalledOnce()
  })
})

describe('getWorkspacePaneTargetIdentities', () => {
  test('reads only worktree and branch identity without status or remote display data', async () => {
    const worktrees = [{ path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true }]
    const worktreeSnapshots = [
      {
        path: '/tmp/repo',
        head: { kind: 'branch' as const, branchName: 'main' },
        headOid: '0123456789abcdef0123456789abcdef01234567',
        operation: null,
        isPrimary: true,
        isLocked: false,
      },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees)
    mocks.readRepoWorktreeSnapshots.mockResolvedValueOnce(worktreeSnapshots)
    mocks.getBranchWorktreeIdentities.mockResolvedValueOnce([
      { branch: 'main', worktreePath: '/tmp/repo' },
      { branch: 'feature/no-worktree', worktreePath: null },
    ])

    const { getWorkspacePaneTargetIdentities } = await import('#/server/modules/repo-read-paths.ts')
    await expect(getWorkspacePaneTargetIdentities(REPO_ID)).resolves.toEqual([
      { branch: 'main', worktreePath: '/tmp/repo' },
      { branch: 'feature/no-worktree', worktreePath: null },
    ])

    expect(mocks.readWorktreeMembership).toHaveBeenCalledWith('/tmp/repo', undefined)
    expect(mocks.getBranchWorktreeIdentities).toHaveBeenCalledWith('/tmp/repo', worktreeSnapshots, {
      signal: undefined,
    })
    expect(mocks.getBranches).not.toHaveBeenCalled()
    expect(mocks.getWorkingStatus).not.toHaveBeenCalled()
    expect(mocks.getRemoteInfo).not.toHaveBeenCalled()
  })
})

describe('getRepoPullRequests', () => {
  test('returns single-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(2)]]))

    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests(REPO_ID, { kind: 'branch-detail', branch: 'feature/a' })

    expect(result).toEqual([{ branch: 'feature/a', pullRequest: pullRequest(2) }])
    expectNoRepoMetadataInvalidations()
  })

  test('returns repository pull request summaries without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(
      new Map([
        ['feature/a', pullRequest(3)],
        ['feature/b', pullRequest(4)],
      ]),
    )

    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests(REPO_ID, { kind: 'repository-summary' })

    expect(result).toEqual([
      { branch: 'feature/a', pullRequest: pullRequest(3) },
      { branch: 'feature/b', pullRequest: pullRequest(4) },
    ])
    expectNoRepoMetadataInvalidations()
  })
})
