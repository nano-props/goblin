import { describe, expect, test, vi } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import {
  REPO_ID,
  deferred,
  expectNoRepoSnapshotInvalidations,
  mocks,
  pullRequest,
  repoQueryInvalidationEvents,
  repoSnapshot,
} from '#/server/test-utils/repo-module.ts'

describe('resolveRemoteWorkspaceTarget', () => {
  test('threads cancellation into SSH config resolution', async () => {
    const signal = new AbortController().signal
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const { resolveRemoteWorkspaceTarget } = await import('#/server/modules/repo-source.ts')

    await resolveRemoteWorkspaceTarget(repoId, { workspaceRuntimeId: 'runtime-test' }, signal)

    expect(mocks.resolveRemoteTarget).toHaveBeenCalledWith({ alias: 'prod', remotePath: '/srv/repo' }, signal)
  })
})

describe('getRepoSnapshot', () => {
  test('reads git state directly without publishing invalidation', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    const snapshot = repoSnapshot('fresh')
    mocks.getBranches.mockResolvedValueOnce(snapshot.branches)
    mocks.getCurrentBranch.mockResolvedValueOnce(snapshot.current)
    mocks.getRemoteInfo.mockResolvedValueOnce(snapshot.remote)

    const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoSnapshot(REPO_ID)

    expect(result).toEqual(snapshot)
    expectNoRepoSnapshotInvalidations()
  })

  test('rejects an authoritative snapshot when branch membership cannot be read', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([])
    mocks.getBranches.mockRejectedValueOnce(new Error('git unavailable'))

    const { getRepoSnapshot } = await import('#/server/modules/repo-read-paths.ts')

    await expect(getRepoSnapshot(REPO_ID)).rejects.toThrow('git unavailable')
    expect(mocks.getRemoteInfo).not.toHaveBeenCalled()
  })
})

describe('getWorkspacePaneTargetIdentities', () => {
  test('reads only worktree and branch identity without status or remote display data', async () => {
    const worktrees = [{ path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true }]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees)
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
    expect(mocks.getBranchWorktreeIdentities).toHaveBeenCalledWith('/tmp/repo', worktrees, { signal: undefined })
    expect(mocks.getBranches).not.toHaveBeenCalled()
    expect(mocks.getWorkingStatus).not.toHaveBeenCalled()
    expect(mocks.getRemoteInfo).not.toHaveBeenCalled()
  })
})

describe('getRepoPullRequests', () => {
  test('returns single-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(new Map([['feature/a', pullRequest(2)]]))

    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests(REPO_ID, ['feature/a'], { mode: 'summary' })

    expect(result).toEqual([{ branch: 'feature/a', pullRequest: pullRequest(2) }])
    expectNoRepoSnapshotInvalidations()
  })

  test('returns multi-branch pull requests without publishing invalidation', async () => {
    mocks.getBranchPullRequests.mockResolvedValueOnce(
      new Map([
        ['feature/a', pullRequest(3)],
        ['feature/b', pullRequest(4)],
      ]),
    )

    const { getRepoPullRequests } = await import('#/server/modules/repo-read-paths.ts')
    const result = await getRepoPullRequests(REPO_ID, ['feature/a', 'feature/b'], { mode: 'full' })

    expect(result).toEqual([
      { branch: 'feature/a', pullRequest: pullRequest(3) },
      { branch: 'feature/b', pullRequest: pullRequest(4) },
    ])
    expectNoRepoSnapshotInvalidations()
  })
})
