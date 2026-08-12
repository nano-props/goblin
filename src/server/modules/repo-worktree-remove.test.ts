import { describe, expect, test, vi } from 'vitest'
import { normalizeRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { commandOutcomeForTest } from '#/test-utils/command-outcome.ts'
import {
  LINKED_REPO_ID,
  REPO_ID,
  WORKTREE_REPO_ID,
  mocks,
  removeLocalRepoWorktreeForTest,
  removeRepoWorktreeForTest,
  successfulRemovalLifecycle,
} from '#/server/test-utils/repo-module.ts'
import { repoRuntimeCapabilityForTest } from '#/server/test-utils/repo-module.ts'

describe('repo worktree removal', () => {
  async function removeRemoteWorktreeForTest() {
    const [{ removeCapturedRepoWorktree }, { issuePhysicalWorktreeExecutionCapability }] = await Promise.all([
      import('#/server/modules/repo-write-paths.ts'),
      import('#/server/worktree-removal/physical-worktree-capability.ts'),
    ])
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const target = {
      id: repoId,
      alias: 'prod',
      host: 'example.test',
      user: 'deploy',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'prod:repo',
      sshConnection: {
        destination: 'prod',
        options: ['hostname=example.test', 'user=deploy', 'port=22'],
      },
    }
    mocks.resolveRemoteTarget.mockResolvedValueOnce({ target })
    const capability = issuePhysicalWorktreeExecutionCapability(
      { kind: 'remote', executionNamespaceId: 'prod-test', endpoint: '/srv/repo-feature' },
      {
        userId: 'test-user',
        workspaceId: repoId,
        workspaceRuntimeId: 'test-runtime',
        worktreePath: '/srv/repo-feature',
        execution: {
          kind: 'remote',
          canonicalWorktreePath: '/srv/repo-feature',
          target,
          configFingerprint: 'test-config-fingerprint',
        },
        runtimeSignal: new AbortController().signal,
      },
    )
    const result = await removeCapturedRepoWorktree(
      repoId,
      { branch: 'feature/a', worktreePath: '/srv/repo-feature', deleteBranch: false },
      successfulRemovalLifecycle,
      capability,
      repoRuntimeCapabilityForTest(repoId, 'test-runtime'),
    )
    return { repoId, result }
  }

  test('removeRepoWorktree publishes snapshot invalidations for affected worktrees after removal success', async () => {
    mocks.resolveRepoCommonDir.mockResolvedValue('/tmp/repo/.git')
    mocks.removeWorktree.mockResolvedValueOnce(commandOutcomeForTest({ ok: true, message: 'ok' }))
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(result).not.toHaveProperty('worktreeRemoved')
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
    expect(result.repoIdsToInvalidate).toEqual([WORKTREE_REPO_ID, REPO_ID])
  })

  test('removeRepoWorktree returns Git removal failure without finalization', async () => {
    mocks.removeWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'git remove failed' }, 'failed'),
    )
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

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: false },
      { ...successfulRemovalLifecycle, afterWorktreeRemoved },
    )
    expect(result).toMatchObject({ ok: false, message: 'git remove failed' })

    expect(afterWorktreeRemoved).not.toHaveBeenCalled()
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).not.toHaveBeenCalled()
    expect(result.repoIdsToInvalidate).toEqual([WORKTREE_REPO_ID, REPO_ID])
  })

  test('removeRepoWorktree fails fast and invalidates projections after a removal timeout', async () => {
    mocks.removeWorktree.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'error.worktree-remove-timeout-check-state' }, 'timed-out'),
    )
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    const afterWorktreeRemoved = vi.fn(async () => ({ ok: true as const, message: '' }))

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: false },
      { ...successfulRemovalLifecycle, afterWorktreeRemoved },
    )

    expect(result).toMatchObject({ ok: false, message: 'error.worktree-remove-timeout-check-state' })
    expect(afterWorktreeRemoved).not.toHaveBeenCalled()
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).not.toHaveBeenCalled()
    expect(result.repoIdsToInvalidate).toEqual([WORKTREE_REPO_ID, REPO_ID])
  })

  test('removeRepoWorktree reports uncertain state when cancellation happened after Git started', async () => {
    mocks.removeWorktree.mockResolvedValueOnce(commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'cancelled'))
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: false }, successfulRemovalLifecycle)

    expect(result).toMatchObject({ ok: false, message: 'error.git-command-cancelled-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([WORKTREE_REPO_ID, REPO_ID])
  })

  test('remote removal preflight failure does not publish mutation invalidations', async () => {
    mocks.removeRemoteWorktree.mockResolvedValueOnce({ ok: false, message: 'error.cannot-remove-main-worktree' })

    const { result } = await removeRemoteWorktreeForTest()

    expect(result).toMatchObject({ ok: false, message: 'error.cannot-remove-main-worktree' })
    expect(result.repoIdsToInvalidate).toBeUndefined()
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).not.toHaveBeenCalled()
  })

  test('remote removal timeout invalidates captured projections without finalizing removal', async () => {
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    mocks.removeRemoteWorktree.mockResolvedValueOnce({
      ok: false,
      message: 'timeout',
      failureExecution: { status: 'timed-out' },
      failureStage: 'worktree-remove',
      worktreePathsToInvalidate: ['/srv/repo', '/srv/repo-feature'],
    })

    const { repoId, result } = await removeRemoteWorktreeForTest()

    expect(result).toMatchObject({ ok: false, message: 'error.worktree-remove-timeout-check-state' })
    expect(result.repoIdsToInvalidate).toEqual([repoId, linkedRepoId])
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).not.toHaveBeenCalled()
  })

  test('prunes settings after an explicit removal lifecycle before propagating a preclassified carrier', async () => {
    const [{ RepoMutationRuntimeFailureError }, { RemoteWorkspaceRuntimeFailureError }] = await Promise.all([
      import('#/server/modules/repo-mutation-runtime-failure.ts'),
      import('#/server/modules/remote-workspace-runtime-failure.ts'),
    ])
    const repoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo' })
    const linkedRepoId = normalizeRemoteWorkspaceId({ alias: 'prod', remotePath: '/srv/repo-feature' })
    const runtimeFailure = new RemoteWorkspaceRuntimeFailureError({
      workspaceId: repoId,
      workspaceRuntimeId: 'test-runtime',
      reason: 'unreachable',
      message: 'branch cleanup connection lost',
    })
    const carrier = new RepoMutationRuntimeFailureError(
      {
        ok: false,
        message: 'error.worktree-removed-followup-failed',
        repoIdsToInvalidate: [repoId, linkedRepoId],
      },
      runtimeFailure,
    )
    mocks.removeRemoteWorktree.mockImplementationOnce(async (_target, input) => {
      const prepared = await input.beforeRemove()
      if (!prepared.ok) return prepared
      const finalized = await input.afterWorktreeRemoved()
      if (!finalized.ok) return finalized
      throw carrier
    })

    await expect(removeRemoteWorktreeForTest()).rejects.toMatchObject({
      runtimeFailure,
      mutation: { repoIdsToInvalidate: [repoId, linkedRepoId] },
    })
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: repoId,
      worktreePath: '/srv/repo-feature',
    })
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

    expect(result).toMatchObject({
      ok: false,
      message: 'tabs finalize failed',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed'],
    })
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      worktreePath: '/tmp/repo-worktree',
    })
  })

  test('removeRepoWorktree surfaces recovery when finalization is cancelled after removal', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: false },
      {
        ...successfulRemovalLifecycle,
        afterWorktreeRemoved: async () => ({ ok: false, message: 'cancelled' }),
      },
    )

    expect(result).toMatchObject({
      ok: false,
      message: 'cancelled',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed'],
    })
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(result.repoIdsToInvalidate).toEqual([WORKTREE_REPO_ID, REPO_ID])
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.getUpstream).toHaveBeenCalledTimes(1)
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'refs/remotes/origin/feature/a', undefined)
    expect(mocks.deleteUpstreamBranch).toHaveBeenCalledWith('/tmp/repo', 'origin', 'feature/a', undefined)
    expect(mocks.getUpstream.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeWorktree.mock.invocationCallOrder[0]!,
    )
  })

  test('reports confirmed local branch deletion when upstream deletion fails after worktree removal', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: 'refs/remotes/origin/feature/a',
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    mocks.deleteUpstreamBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'upstream rejected deletion' }, 'failed'),
    )

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true, deleteUpstream: true },
      successfulRemovalLifecycle,
    )

    expect(result).toMatchObject({
      ok: false,
      message: 'upstream rejected deletion',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed', 'error.local-branch-deleted-followup-failed'],
    })
    expect(mocks.deleteUpstreamBranch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pruneServerWorkspaceSettingsForRemovedWorktree.mock.invocationCallOrder[0]!,
    )
  })

  test('reports confirmed local branch deletion when upstream deletion is cancelled after worktree removal', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: 'refs/remotes/origin/feature/a',
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    mocks.deleteUpstreamBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'cancelled'),
    )

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true, deleteUpstream: true },
      successfulRemovalLifecycle,
    )

    expect(result).toMatchObject({
      ok: false,
      message: 'error.git-command-cancelled-check-state',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed', 'error.local-branch-deleted-followup-failed'],
    })
  })

  test('reports confirmed local branch deletion when upstream deletion times out after worktree removal', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.isAncestor.mockResolvedValue(true)
    mocks.getUpstream.mockResolvedValueOnce({
      ancestryRef: 'refs/remotes/origin/feature/a',
      source: { remote: 'origin', branch: 'feature/a' },
      deleteTarget: { remote: 'origin', branch: 'feature/a' },
    })
    mocks.deleteUpstreamBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'git timed out after 90s' }, 'timed-out'),
    )

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true, deleteUpstream: true },
      successfulRemovalLifecycle,
    )

    expect(result).toMatchObject({
      ok: false,
      message: 'error.git-command-timeout-check-state',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed', 'error.local-branch-deleted-followup-failed'],
    })
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

    expect(result).toMatchObject({ ok: false, message: 'error.cannot-remove-unpushed-worktree' })
    expect(mocks.isAncestor).toHaveBeenCalledOnce()
    expect(mocks.isAncestor).toHaveBeenCalledWith('/tmp/repo', 'feature/a', 'main', undefined)
    expect(beforeRemove).not.toHaveBeenCalled()
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
    expect(mocks.deleteBranch).not.toHaveBeenCalled()
    expect(result.repoIdsToInvalidate).toBeUndefined()
  })

  test('removeRepoWorktree preserves an ordinary branch deletion failure after removal', async () => {
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
    mocks.deleteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'fatal: delete failed' }, 'failed'),
    )

    const result = await removeLocalRepoWorktreeForTest({ deleteBranch: true }, successfulRemovalLifecycle)

    expect(result).toMatchObject({
      ok: false,
      message: 'fatal: delete failed',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed'],
    })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-worktree', undefined)
    expect(mocks.pruneServerWorkspaceSettingsForRemovedWorktree).toHaveBeenCalledWith({
      workspaceId: REPO_ID,
      worktreePath: '/tmp/repo-worktree',
    })
    expect(result.repoIdsToInvalidate).toEqual([WORKTREE_REPO_ID, REPO_ID])
  })

  test('removeRepoWorktree reports uncertain local branch deletion when it is cancelled after removal', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)
    mocks.deleteBranch.mockResolvedValueOnce(commandOutcomeForTest({ ok: false, message: 'cancelled' }, 'cancelled'))

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true, forceDeleteBranch: true },
      successfulRemovalLifecycle,
    )

    expect(result).toMatchObject({
      ok: false,
      message: 'error.git-command-cancelled-check-state',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed'],
      repoIdsToInvalidate: [WORKTREE_REPO_ID, REPO_ID],
    })
  })

  test('removeRepoWorktree reports uncertain local branch deletion when it times out after removal', async () => {
    const worktrees = [
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ]
    mocks.readWorktreeMembership.mockResolvedValueOnce(worktrees).mockResolvedValueOnce(worktrees)
    mocks.deleteBranch.mockResolvedValueOnce(
      commandOutcomeForTest({ ok: false, message: 'git timed out after 30s' }, 'timed-out'),
    )

    const result = await removeLocalRepoWorktreeForTest(
      { deleteBranch: true, forceDeleteBranch: true },
      successfulRemovalLifecycle,
    )

    expect(result).toMatchObject({
      ok: false,
      message: 'error.git-command-timeout-check-state',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed'],
      repoIdsToInvalidate: [WORKTREE_REPO_ID, REPO_ID],
    })
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
    expect(mocks.getCurrentBranch).toHaveBeenCalledWith('/tmp/repo', { signal: undefined })
    expect(mocks.removeWorktree).toHaveBeenCalledWith('/tmp/repo', '/tmp/repo-linked', undefined)
    expect(mocks.deleteBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/a', { force: undefined, signal: undefined })
    expect(result.repoIdsToInvalidate).toEqual([LINKED_REPO_ID, REPO_ID])
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

    expect(result).toMatchObject({ ok: true, message: 'ok' })
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

    expect(result).toMatchObject({
      ok: false,
      message: 'settings write failed',
      recoveryMessageKeys: ['error.worktree-removed-followup-failed'],
    })
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

    expect(result).toMatchObject({ ok: false, message: 'error.cannot-remove-locked-worktree' })
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })

  test('removeRepoWorktree refuses when worktree status could not be read', async () => {
    mocks.readWorktreeMembership.mockResolvedValueOnce([
      { path: '/tmp/repo', branch: 'main', isBare: false, isPrimary: true },
      { path: '/tmp/repo-worktree', branch: 'feature/a', isBare: false, isPrimary: false },
    ])
    mocks.sampleWorktreeStatusForTarget.mockRejectedValueOnce(new Error('status failed'))

    await expect(removeLocalRepoWorktreeForTest({ deleteBranch: false }, successfulRemovalLifecycle)).rejects.toThrow(
      'status failed',
    )
    expect(mocks.removeWorktree).not.toHaveBeenCalled()
  })
})
