import { describe, expect, test, vi } from 'vitest'
import { createWorktreeRemovalApplication } from '#/server/worktree-removal/worktree-removal-application.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import { normalizeRemoteRepoId } from '#/shared/remote-repo.ts'
import {
  testPhysicalWorktreeCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
  issueTestPhysicalWorktreeCapability,
} from '#/server/test-utils/physical-worktree-identity.ts'
import type { PhysicalWorktreeIdentity } from '#/server/worktree-removal/physical-worktree-identity.ts'
import type { WorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import type { ServerWorkspacePaneTargetLifecycleHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { RemoteRepoRuntimeFailureError } from '#/server/modules/remote-runtime-failure.ts'

const failRemoteRuntimeIfNeededMock = vi.hoisted(() => vi.fn())
vi.mock('#/server/modules/remote-runtime-failure-settlement.ts', async (importActual) => {
  const actual = await importActual<typeof import('#/server/modules/remote-runtime-failure-settlement.ts')>()
  return { ...actual, failRemoteRuntimeIfNeeded: failRemoteRuntimeIfNeededMock }
})

const target = {
  repoRoot: '/repo',
  repoRuntimeId: 'repo-runtime-test',
  worktreePath: '/repo/worktree',
  branchName: 'feature/worktree',
  deleteBranch: false,
}

describe('WorktreeRemovalApplication', () => {
  test('gates one physical worktree across users and repo runtime ids until removal settles', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const physicalIdentity = testPhysicalWorktreeIdentity(target.worktreePath)
    const physicalCapability = issueTestPhysicalWorktreeCapability({ identity: physicalIdentity })
    const finish = deferred<void>()
    const application = createApplication({
      operations,
      physicalWorktrees: { capture: async () => physicalCapability },
    })
    const removal = application.removeWorktree('user-a', {
      ...target,
      async remove(_capability, lifecycle) {
        const prepared = await lifecycle.beforeRemove()
        if (!prepared.ok) return prepared
        await finish.promise
        await lifecycle.afterWorktreeRemoved()
        return { ok: true, message: 'removed' }
      },
    })
    await vi.waitFor(() => expect(operations.isRemovalAdmitted(physicalCapability)).toBe(true))

    expect(operations.isRemovalAdmitted(physicalCapability)).toBe(true)
    expect(operations.isRemovalAdmitted(testPhysicalWorktreeIdentity('/other-worktree'))).toBe(false)

    finish.resolve()
    await expect(removal).resolves.toEqual({ ok: true, message: 'removed' })
  })

  test('gates one remote endpoint across repository entries without blocking another host or worktree', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const finish = deferred<void>()
    const physicalIdentity = remoteIdentity('0123456789abcdef0123456789abcdef', '/srv/repo-linked')
    const physicalCapability = issueTestPhysicalWorktreeCapability({ identity: physicalIdentity })
    const application = createApplication({
      operations,
      physicalWorktrees: { capture: async () => physicalCapability },
    })
    const primaryRepo = normalizeRemoteRepoId({ alias: 'build-host', remotePath: '/srv/repo' })
    const removal = application.removeWorktree('user-a', {
      repoRoot: primaryRepo,
      repoRuntimeId: target.repoRuntimeId,
      worktreePath: '/srv/repo-linked',
      branchName: target.branchName,
      deleteBranch: false,
      async remove(_capability, lifecycle) {
        const prepared = await lifecycle.beforeRemove()
        if (!prepared.ok) return prepared
        await finish.promise
        await lifecycle.afterWorktreeRemoved()
        return { ok: true, message: 'removed' }
      },
    })
    await vi.waitFor(() => expect(operations.isRemovalAdmitted(physicalCapability)).toBe(true))

    expect(operations.isRemovalAdmitted(remoteIdentity('fedcba9876543210fedcba9876543210', '/srv/repo-linked'))).toBe(
      false,
    )
    expect(operations.isRemovalAdmitted(remoteIdentity('0123456789abcdef0123456789abcdef', '/srv/repo-other'))).toBe(
      false,
    )

    finish.resolve()
    await expect(removal).resolves.toEqual({ ok: true, message: 'removed' })
  })

  test('reconciles every affected user scope after Git removal fails', async () => {
    const affectedScopes = [
      { userId: 'user-a', repoRoot: '/repo', scope: '/repo\0runtime-a' },
      { userId: 'user-b', repoRoot: '/repo', scope: '/repo\0runtime-b' },
    ]
    const reconcilePhysicalWorktreeAfterRemovalFailure = vi.fn(async () => {})
    const retireTarget = vi.fn(async () => ({ revision: 0, entries: [] }))
    const broadcastWorkspaceTabsChanged = vi.fn()
    const application = createApplication({
      terminalScopes: affectedScopes,
      reconcilePhysicalWorktreeAfterRemovalFailure,
      retireTarget,
      broadcastWorkspaceTabsChanged,
    })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        async remove(_capability, lifecycle) {
          const prepared = await lifecycle.beforeRemove()
          if (!prepared.ok) return prepared
          await lifecycle.afterRemoveFailed()
          return { ok: false, message: 'git remove failed' }
        },
      }),
    ).resolves.toEqual({ ok: false, message: 'git remove failed' })

    expect(retireTarget).not.toHaveBeenCalled()
    expect(reconcilePhysicalWorktreeAfterRemovalFailure).toHaveBeenCalledWith({
      repoRoot: target.repoRoot,
      worktreePath: target.worktreePath,
      physicalWorktreeCapability: expect.objectContaining({
        identity: testPhysicalWorktreeIdentity(target.worktreePath),
      }),
      permit: expect.objectContaining({ operationId: expect.any(Number) }),
      scopes: affectedScopes,
    })
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-a', target.repoRoot)
    expect(broadcastWorkspaceTabsChanged).toHaveBeenCalledWith('user-b', target.repoRoot)
  })

  test('leaves runtime resources untouched when repository validation rejects removal', async () => {
    const closeSessionsForPhysicalWorktree = vi.fn(async () => [])
    const retireTarget = vi.fn(async () => ({ revision: 0, entries: [] }))
    const application = createApplication({ closeSessionsForPhysicalWorktree, retireTarget })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        remove: async () => ({ ok: false, message: 'error.cannot-remove-dirty-worktree' }),
      }),
    ).resolves.toEqual({ ok: false, message: 'error.cannot-remove-dirty-worktree' })
    expect(closeSessionsForPhysicalWorktree).not.toHaveBeenCalled()
    expect(retireTarget).not.toHaveBeenCalled()
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
        async remove(_capability, lifecycle) {
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

  test('runtime close cancels an admitted removal before the destructive mutation settles', async () => {
    const runtime = new AbortController()
    const entered = Promise.withResolvers<void>()
    const capability = issueTestPhysicalWorktreeCapability({
      identity: testPhysicalWorktreeIdentity(target.worktreePath),
      runtimeSignal: runtime.signal,
    })
    const application = createApplication({ physicalWorktrees: { capture: async () => capability } })
    const removal = application.removeWorktree('user-a', {
      ...target,
      async remove(_capability, lifecycle, signal) {
        const prepared = await lifecycle.beforeRemove()
        if (!prepared.ok) return prepared
        entered.resolve()
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        return { ok: false, message: 'error.repo-runtime-stale' }
      },
    })
    await entered.promise
    runtime.abort(new Error('error.repo-runtime-stale'))
    await expect(removal).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
  })

  test('runtime close cancels a queued removal before its task starts', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const runtime = new AbortController()
    const capability = issueTestPhysicalWorktreeCapability({
      identity: testPhysicalWorktreeIdentity(target.worktreePath),
      runtimeSignal: runtime.signal,
    })
    const gate = Promise.withResolvers<void>()
    const active = operations.runOperation(capability, async () => await gate.promise)
    const remove = vi.fn(async () => ({ ok: true as const, message: 'removed' }))
    const application = createApplication({ operations, physicalWorktrees: { capture: async () => capability } })
    const queued = application.removeWorktree('user-a', { ...target, remove })
    runtime.abort(new Error('error.repo-runtime-stale'))
    await expect(queued).resolves.toEqual({ ok: false, message: 'error.repo-runtime-stale' })
    expect(remove).not.toHaveBeenCalled()
    gate.resolve()
    await active.catch(() => undefined)
  })

  test('fails remote lifecycle when capture hits a remote runtime failure', async () => {
    const failure = new RemoteRepoRuntimeFailureError({
      repoRoot: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
      reason: 'unreachable',
      message: 'connection refused',
    })
    failRemoteRuntimeIfNeededMock.mockClear()
    const application = createApplication({
      physicalWorktrees: {
        capture: async () => {
          throw failure
        },
      },
    })

    await expect(
      application.removeWorktree('user-a', { ...target, remove: async () => ({ ok: true, message: '' }) }),
    ).resolves.toEqual({ ok: false, message: 'connection refused' })
    expect(failRemoteRuntimeIfNeededMock).toHaveBeenCalledWith('user-a', failure)
  })

  test('fails remote lifecycle when queued validation hits a remote runtime failure', async () => {
    const failure = new RemoteRepoRuntimeFailureError({
      repoRoot: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
      reason: 'unreachable',
      message: 'connection refused',
    })
    const capability = issueTestPhysicalWorktreeCapability({
      identity: testPhysicalWorktreeIdentity(target.worktreePath),
      validateExecution: async () => {
        throw failure
      },
    })
    failRemoteRuntimeIfNeededMock.mockClear()
    const application = createApplication({
      physicalWorktrees: { capture: async () => capability },
    })

    await expect(
      application.removeWorktree('user-a', { ...target, remove: async () => ({ ok: true, message: '' }) }),
    ).resolves.toEqual({ ok: false, message: 'connection refused' })
    expect(failRemoteRuntimeIfNeededMock).toHaveBeenCalledWith('user-a', failure)
  })

  test('retires the branch target after worktree and branch removal both succeed', async () => {
    const retireTarget = vi.fn(async () => ({ revision: 1, entries: [] }))
    const application = createApplication({ retireTarget })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        deleteBranch: true,
        async remove(_capability, lifecycle) {
          const prepared = await lifecycle.beforeRemove()
          if (!prepared.ok) return prepared
          const finalized = await lifecycle.afterWorktreeRemoved()
          if (!finalized.ok) return finalized
          return { ok: true, message: 'removed' }
        },
      }),
    ).resolves.toEqual({ ok: true, message: 'removed' })

    expect(retireTarget).toHaveBeenCalledWith('user-a', {
      repoRuntimeId: target.repoRuntimeId,
      target: { kind: 'branch', repoRoot: target.repoRoot, branchName: target.branchName },
    })
  })

  test('reports the committed repository change when branch retirement fails after worktree removal', async () => {
    const retireTarget = vi.fn(async () => {
      throw new Error('pane persistence failed')
    })
    const application = createApplication({ retireTarget })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        deleteBranch: true,
        async remove(_capability, lifecycle) {
          const prepared = await lifecycle.beforeRemove()
          if (!prepared.ok) return prepared
          const finalized = await lifecycle.afterWorktreeRemoved()
          if (!finalized.ok) return finalized
          return { ok: true, message: 'removed' }
        },
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'pane persistence failed',
      repositoryStateChanged: true,
    })
  })

  test('retires each repository target that references one removed physical worktree', async () => {
    const retireTarget = vi.fn(async () => ({ revision: 1, entries: [] }))
    const physicalWorktreeTargets = [
      {
        userId: 'user-a',
        scope: '/repo\0runtime-a',
        repoRuntimeId: 'runtime-a',
        target: { kind: 'worktree' as const, repoRoot: '/repo', worktreePath: '/repo/worktree' },
      },
      {
        userId: 'user-a',
        scope: '/linked-repo\0runtime-b',
        repoRuntimeId: 'runtime-b',
        target: { kind: 'worktree' as const, repoRoot: '/linked-repo', worktreePath: '/linked/worktree' },
      },
    ]
    const broadcastSessionsChanged = vi.fn()
    const application = createApplication({ retireTarget, physicalWorktreeTargets, broadcastSessionsChanged })

    await expect(
      application.removeWorktree('user-a', {
        ...target,
        async remove(_capability, lifecycle) {
          const prepared = await lifecycle.beforeRemove()
          if (!prepared.ok) return prepared
          return await lifecycle.afterWorktreeRemoved()
        },
      }),
    ).resolves.toEqual({ ok: true, message: '' })

    expect(retireTarget).toHaveBeenCalledTimes(2)
    expect(retireTarget).toHaveBeenNthCalledWith(1, 'user-a', {
      repoRuntimeId: 'repo-runtime-test',
      target: { kind: 'worktree', repoRoot: '/repo', worktreePath: '/repo/worktree' },
    })
    expect(retireTarget).toHaveBeenNthCalledWith(2, 'user-a', {
      repoRuntimeId: 'runtime-b',
      target: { kind: 'worktree', repoRoot: '/linked-repo', worktreePath: '/linked/worktree' },
    })
    expect(broadcastSessionsChanged).toHaveBeenCalledWith('user-a', '/repo')
    expect(broadcastSessionsChanged).toHaveBeenCalledWith('user-a', '/linked-repo')
  })
})

function createApplication(
  options: {
    operations?: ReturnType<typeof createPhysicalWorktreeOperationCoordinator>
    physicalWorktrees?: typeof testPhysicalWorktrees
    terminalScopes?: Array<{ userId: string; repoRoot: string; scope: string }>
    terminalQuiescence?:
      | { ok: true; scopes: Array<{ userId: string; repoRoot: string; scope: string }> }
      | { ok: false; scopes: Array<{ userId: string; repoRoot: string; scope: string }>; message: string }
    closeSessionsForPhysicalWorktree?: (
      identity: PhysicalWorktreeIdentity,
    ) => Promise<Array<{ userId: string; repoRoot: string; scope: string }>>
    reconcilePhysicalWorktreeAfterRemovalFailure?: () => Promise<void>
    retireTarget?: ServerWorkspacePaneTargetLifecycleHost['retireTarget']
    physicalWorktreeTargets?: ReturnType<WorkspacePaneTabsCoordinator['physicalWorktreeTargets']>
    broadcastWorkspaceTabsChanged?: (userId: string, repoRoot: string) => void
    broadcastSessionsChanged?: (userId: string, repoRoot: string) => void
  } = {},
) {
  return createWorktreeRemovalApplication({
    worktreeOperations: options.operations ?? createPhysicalWorktreeOperationCoordinator(),
    physicalWorktrees: options.physicalWorktrees ?? testPhysicalWorktrees,
    terminalWorktree: {
      closeSessionsForPhysicalWorktree: async (capability) => ({
        ...(options.terminalQuiescence ?? {
          ok: true as const,
          scopes: options.closeSessionsForPhysicalWorktree
            ? await options.closeSessionsForPhysicalWorktree(capability.identity)
            : (options.terminalScopes ?? []),
        }),
      }),
    },
    workspaceTabs: {
      physicalWorktreeTargets: () => options.physicalWorktreeTargets ?? [],
      reconcilePhysicalWorktreeAfterRemovalFailure:
        options.reconcilePhysicalWorktreeAfterRemovalFailure ?? (async () => {}),
    },
    workspacePaneTabs: {
      retireTarget: options.retireTarget ?? (async () => ({ revision: 0, entries: [] })),
    },
    isCurrentRepoRuntime: () => true,
    broadcastSessionsChanged: options.broadcastSessionsChanged ?? (() => {}),
    broadcastWorkspaceTabsChanged: options.broadcastWorkspaceTabsChanged ?? (() => {}),
  })
}

function remoteIdentity(executionNamespaceId: string, endpoint: string): PhysicalWorktreeIdentity {
  return { kind: 'remote', executionNamespaceId, endpoint }
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
