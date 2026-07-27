import { describe, expect, test, vi } from 'vitest'
import {
  LINKED_REPO_ID,
  REPO_ID,
  WORKTREE_REPO_ID,
  expectNoRepoSnapshotInvalidations,
  expectRepoSnapshotInvalidations,
  mocks,
  removeLocalRepoWorktreeForTest,
  removeRepoWorktreeForTest,
  successfulRemovalLifecycle,
} from '#/server/test-utils/repo-module.ts'

describe('repo worktree removal', () => {
  test('removeRepoWorktree publishes snapshot invalidations for affected worktrees after removal success', async () => {
    mocks.resolveRepoCommonDir.mockResolvedValue('/tmp/repo/.git')
    mocks.removeWorktree.mockResolvedValueOnce({
      ok: true,
      message: 'ok',
    })
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])
    const { readRepoOperationsSnapshot } = await import('#/server/modules/repo-read-paths.ts')
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))
    const afterWorktreeRemoved = vi.fn(async () => ({ ok: true as const, message: '' }))

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: false },
      { ...successfulRemovalLifecycle, beforeRemove, afterWorktreeRemoved },
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(beforeRemove).toHaveBeenCalledOnce()
    expect(afterWorktreeRemoved).toHaveBeenCalledOnce()
    expect(beforeRemove.mock.invocationCallOrder[0]).toBeLessThan(mocks.removeWorktree.mock.invocationCallOrder[0]!)
    expect(mocks.removeWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      afterWorktreeRemoved.mock.invocationCallOrder[0]!,
    )
    expect((await readRepoOperationsSnapshot(REPO_ID)).operations).toEqual([])
    expect((await readRepoOperationsSnapshot(REPO_ID, { includeSettled: true })).operations[0]).toMatchObject({
      kind: 'remove-worktree',
      phase: 'done',
      target: { branch: 'feature/a', worktreePath: '/tmp/repo-worktree' },
    })
    expectRepoSnapshotInvalidations(
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: WORKTREE_REPO_ID,
        query: 'repo-snapshot',
      },
    )
  })

  test('removeRepoWorktree returns Git removal failure without finalization', async () => {
    mocks.removeWorktree.mockResolvedValueOnce({ ok: false, message: 'git remove failed' })
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])
    const afterWorktreeRemoved = vi.fn(async () => ({ ok: true as const, message: '' }))

    await expect(
      removeLocalRepoWorktreeForTest(
        { deleteBranch: false },
        { ...successfulRemovalLifecycle, afterWorktreeRemoved },
      ),
    ).resolves.toEqual({ ok: false, message: 'git remove failed' })

    expect(afterWorktreeRemoved).not.toHaveBeenCalled()
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree prunes settings when application finalization fails after removal', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: false },
      {
        ...successfulRemovalLifecycle,
        afterWorktreeRemoved: async () => ({ ok: false, message: 'tabs finalize failed' }),
      },
    )

    expect(result).toEqual({ ok: false, message: 'tabs finalize failed', repositoryStateChanged: true })
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      worktreePath: '/tmp/repo-worktree',
    })
  })

  test('removeRepoWorktree publishes affected snapshot invalidations once after worktree and branch deletion success', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: true }, successfulRemovalLifecycle)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expectRepoSnapshotInvalidations(
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: WORKTREE_REPO_ID,
        query: 'repo-snapshot',
      },
    )
  })

  test('removeRepoWorktree freezes one upstream read before worktree removal', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])
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

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true, deleteUpstream: true },
      successfulRemovalLifecycle,
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.getUpstream).toHaveBeenCalledTimes(1)
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'refs/remotes/origin/feature/a', undefined)
    expect(mocks.deleteUpstreamBranch).toHaveBeenCalledWith('/tmp/repo', 'origin', 'feature/a', undefined)
    expect(mocks.getUpstream.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeWorktree.mock.invocationCallOrder[0]!,
    )
  })

  test('removeRepoWorktree does not use a missing tracking ref for branch deletion admission', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])
    mocks.isAncestor.mockResolvedValueOnce(false)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: null,
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    const beforeRemove = vi.fn(async () => ({ ok: true as const, message: '' }))

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true },
      { ...successfulRemovalLifecycle, beforeRemove },
    )

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })
    expect(mocks.isAncestor).toHaveBeenCalledOnce()
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'main', undefined)
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expectNoRepoSnapshotInvalidations()
  })

  test('removeRepoWorktree publishes affected invalidations after branch deletion fails post-removal', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)
    mocks.deleteBranch.mockResolvedValueOnce({ ok: false, message: 'fatal: delete failed' })

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: true }, successfulRemovalLifecycle)

    expect(result).toEqual({ ok: false, message: 'fatal: delete failed', repositoryStateChanged: true })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', undefined)
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      worktreePath: '/tmp/repo-worktree',
    })
    expectRepoSnapshotInvalidations(
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: WORKTREE_REPO_ID,
        query: 'repo-snapshot',
      },
    )
  })

  test('removeRepoWorktree can remove and delete the currently opened linked worktree', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-linked',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)

    const result = await removeRepoWorktreeForTest(
      LINKED_REPO_ID,
      {
        branch: 'feature/a',
        worktreePath: '/tmp/repo-linked',
        deleteBranch: true,
      },
      successfulRemovalLifecycle,
    )

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.getCurrentBranch).toHaveBeenCalledWith('/tmp/repo', { signal: undefined })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-linked', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
    expectRepoSnapshotInvalidations(
      {
        repoId: LINKED_REPO_ID,
        query: 'repo-snapshot',
      },
      {
        repoId: REPO_ID,
        query: 'repo-snapshot',
      },
    )
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: LINKED_REPO_ID,
      worktreePath: '/tmp/repo-linked',
    })
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree publishes settings invalidation when worktree-scoped settings are pruned', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)
    mocks.pruneServerWorkspaceSettingsForRemovedWorktree.mockResolvedValueOnce(true)

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: false }, successfulRemovalLifecycle)

    expect(result).toEqual({ ok: true, message: 'ok' })
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      worktreePath: '/tmp/repo-worktree',
    })
    expect(mocks.publishSettingsInvalidation).toHaveBeenCalledWith(['settings-snapshot'])
  })

  test('removeRepoWorktree reports settings failure after removing the worktree', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
      },
    ])
    mocks.pruneServerWorkspaceSettingsForRemovedWorktree.mockRejectedValueOnce(new Error('settings write failed'))

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: false }, successfulRemovalLifecycle)

    expect(result).toEqual({ ok: false, message: 'error.settings-write-title', repositoryStateChanged: true })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', undefined)
    expect(mocks.publishSettingsInvalidation).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree refuses locked worktrees before calling git remove', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      {
        path: '/tmp/repo-worktree',
        branch: 'feature/a',
        isBare: false,
        isPrimary: false,
        isLocked: true,
      },
    ])

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: false }, successfulRemovalLifecycle)

    expect(result).toEqual({ ok: false, message: 'error.cannot-remove-locked-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree refuses when worktree status could not be read', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.sampleWorktreeStatusForTarget.mockRejectedValueOnce(new Error('status failed'))

    await expect(
      removeLocalRepoWorktreeForTest({ deleteBranch: false }, successfulRemovalLifecycle),
    ).rejects.toThrow('status failed')
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })
})
