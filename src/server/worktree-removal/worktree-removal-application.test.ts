import { describe, expect, test, vi } from 'vitest'
import { createWorktreeRemovalApplication } from '#/server/worktree-removal/worktree-removal-application.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'

const target = {
  repoRoot: '/repo',
  repoRuntimeId: 'repo-runtime-test',
  worktreePath: '/repo/worktree',
}

describe('WorktreeRemovalApplication', () => {
  test('gates one physical worktree across users and repo runtime ids until removal settles', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const finish = deferred<void>()
    const application = createApplication({ operations })
    const removal = application.removeWorktree('user-a', {
      ...target,
      async remove(lifecycle) {
        const prepared = await lifecycle.beforeRemove()
        if (!prepared.ok) return prepared
        await finish.promise
        await lifecycle.afterWorktreeRemoved()
        return { ok: true, message: 'removed' }
      },
    })
    await vi.waitFor(() =>
      expect(operations.isRemovalAdmitted({ repoRoot: target.repoRoot, worktreePath: target.worktreePath })).toBe(true),
    )

    expect(operations.isRemovalAdmitted({ repoRoot: target.repoRoot, worktreePath: target.worktreePath })).toBe(true)
    expect(operations.isRemovalAdmitted({ repoRoot: '/repo/worktree', worktreePath: target.worktreePath })).toBe(true)
    expect(operations.isRemovalAdmitted({ repoRoot: '/other-repo', worktreePath: '/other-worktree' })).toBe(false)

    finish.resolve()
    await expect(removal).resolves.toEqual({ ok: true, message: 'removed' })
  })

  test('gates one remote endpoint across repository entries without blocking another host or worktree', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const finish = deferred<void>()
    const application = createApplication({ operations })
    const primaryRepo = normalizeRemoteRepoId({ alias: 'build-host', remotePath: '/srv/repo' })
    const linkedRepo = normalizeRemoteRepoId({ alias: 'build-host', remotePath: '/srv/repo-linked' })
    const otherHost = normalizeRemoteRepoId({ alias: 'other-host', remotePath: '/srv/repo-linked' })
    const removal = application.removeWorktree('user-a', {
      repoRoot: primaryRepo,
      repoRuntimeId: target.repoRuntimeId,
      worktreePath: '/srv/repo-linked',
      async remove(lifecycle) {
        const prepared = await lifecycle.beforeRemove()
        if (!prepared.ok) return prepared
        await finish.promise
        await lifecycle.afterWorktreeRemoved()
        return { ok: true, message: 'removed' }
      },
    })
    await vi.waitFor(() =>
      expect(operations.isRemovalAdmitted({ repoRoot: linkedRepo, worktreePath: '/srv/repo-linked' })).toBe(true),
    )

    expect(operations.isRemovalAdmitted({ repoRoot: otherHost, worktreePath: '/srv/repo-linked' })).toBe(false)
    expect(operations.isRemovalAdmitted({ repoRoot: linkedRepo, worktreePath: '/srv/repo-other' })).toBe(false)

    finish.resolve()
    await expect(removal).resolves.toEqual({ ok: true, message: 'removed' })
  })

  test('reconciles every affected user scope after Git removal fails', async () => {
    const affectedScopes = [
      { userId: 'user-a', scope: '/repo\0runtime-a' },
      { userId: 'user-b', scope: '/repo\0runtime-b' },
    ]
    const reconcilePhysicalWorktreeAfterRemovalFailure = vi.fn(async () => {})
    const finalizePhysicalWorktreeRemoval = vi.fn(async () => {})
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createApplication({
      terminalScopes: affectedScopes,
      reconcilePhysicalWorktreeAfterRemovalFailure,
      finalizePhysicalWorktreeRemoval,
      broadcastWorkspaceTabsChanged,
    })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        async remove(lifecycle) {
          const prepared = await lifecycle.beforeRemove()
          if (!prepared.ok) return prepared
          await lifecycle.afterRemoveFailed()
          return { ok: false, message: 'git remove failed' }
        },
      }),
    ).resolves.toEqual({ ok: false, message: 'git remove failed' })

    expect(finalizePhysicalWorktreeRemoval).not.toHaveBeenCalled()
    expect(reconcilePhysicalWorktreeAfterRemovalFailure).toHaveBeenCalledWith({
      repoRoot: target.repoRoot,
      worktreePath: target.worktreePath,
      scopes: affectedScopes,
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-a', target.repoRoot)
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-b', target.repoRoot)
  })

  test('leaves runtime resources untouched when repository validation rejects removal', async () => {
    const closeSessionsForPhysicalWorktree = vi.fn(async () => [])
    const finalizePhysicalWorktreeRemoval = vi.fn(async () => {})
    const application = createApplication({ closeSessionsForPhysicalWorktree, finalizePhysicalWorktreeRemoval })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        remove: async () => ({ ok: false, message: 'error.cannot-remove-dirty-worktree' }),
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })
    expect(closeSessionsForPhysicalWorktree).not.toHaveBeenCalled()
    expect(finalizePhysicalWorktreeRemoval).not.toHaveBeenCalled()
  })

  test('aborts before Git remove when terminal quiescence cannot be confirmed', async () => {
    const removeCommit = vi.fn()
    const reconcilePhysicalWorktreeAfterRemovalFailure = vi.fn(async () => {})
    const application = createApplication({
      terminalQuiescence: { ok: false, scopes: [], message: 'PTY close timed out' },
      reconcilePhysicalWorktreeAfterRemovalFailure,
    })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        async remove(lifecycle) {
          const prepared = await lifecycle.beforeRemove()
          if (!prepared.ok) return prepared
          removeCommit()
          return { ok: true, message: 'removed' }
        },
      }),
    ).resolves.toEqual({ ok: false, message: 'PTY close timed out' })
    expect(removeCommit).not.toHaveBeenCalled()
    expect(reconcilePhysicalWorktreeAfterRemovalFailure).toHaveBeenCalledOnce()
  })
})

function createApplication(
  options: {
    operations?: ReturnType<typeof createPhysicalWorktreeOperationCoordinator>
    terminalScopes?: Array<{ userId: string; scope: string }>
    terminalQuiescence?:
      | { ok: true; scopes: Array<{ userId: string; scope: string }> }
      | { ok: false; scopes: Array<{ userId: string; scope: string }>; message: string }
    closeSessionsForPhysicalWorktree?: (
      repoRoot: string,
      worktreePath: string,
    ) => Promise<Array<{ userId: string; scope: string }>>
    reconcilePhysicalWorktreeAfterRemovalFailure?: () => Promise<void>
    finalizePhysicalWorktreeRemoval?: () => Promise<void>
    broadcastWorkspaceTabsChanged?: (userId: string, repoRoot: string) => void
    broadcastSessionsChanged?: (userId: string, repoRoot: string) => void
  } = {},
) {
  return createWorktreeRemovalApplication({
    worktreeOperations: options.operations ?? createPhysicalWorktreeOperationCoordinator(),
    terminalWorktree: {
      closeSessionsForPhysicalWorktree: async (repoRoot, worktreePath) => ({
        ...(options.terminalQuiescence ?? {
          ok: true as const,
          scopes: options.closeSessionsForPhysicalWorktree
            ? await options.closeSessionsForPhysicalWorktree(repoRoot, worktreePath)
            : (options.terminalScopes ?? []),
        }),
      }),
    },
    workspaceTabs: {
      physicalWorktreeScopes: () => [],
      finalizePhysicalWorktreeRemoval: options.finalizePhysicalWorktreeRemoval ?? (async () => {}),
      reconcilePhysicalWorktreeAfterRemovalFailure:
        options.reconcilePhysicalWorktreeAfterRemovalFailure ?? (async () => {}),
    },
    isCurrentRepoRuntime: () => true,
    broadcastSessionsChanged: options.broadcastSessionsChanged ?? (() => {}),
    broadcastWorkspaceTabsChanged: options.broadcastWorkspaceTabsChanged ?? (() => {}),
  })
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
