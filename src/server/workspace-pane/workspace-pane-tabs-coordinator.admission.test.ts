// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import type { WorkspacePaneTargetProjection } from '#/server/workspace-pane/workspace-pane-layout-projection.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { createMemoryWorkspacePaneLayoutRepository } from '#/server/test-utils/workspace-pane-layout-repository.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import {
  WORKSPACE_ID,
  LOCAL_WORKSPACE_ENTRY,
  TEST_EPOCH_CAPABILITY,
  TEST_MEMBERSHIP_CAPABILITY,
  aggregateFor,
  testTargetProjection,
  testRuntimeTargetProjection,
  type TestWorkspacePaneTarget,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.test-utils.ts'

function memoryRepository(initial?: WorkspacePaneDurableLayout) {
  return createMemoryWorkspacePaneLayoutRepository(WORKSPACE_ID, initial)
}

describe('workspace pane tabs coordinator admission queues', () => {
  test('does not commit admission when the target projection no longer contains the worktree', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const commitAdmission = vi.fn()
    const captureSnapshotForUser = vi.fn(async () => ({ revision: 0, liveSessions: [] }))
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          captureSnapshotForUser,
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: testTargetProjection([]),
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            workspaceId: WORKSPACE_ID,
            branchName: 'main',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          insertAfterIdentity: 'workspace-pane:status',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted.admitted).toBe(true)
    if (!admitted.admitted) return
    expect(admitted.value).toEqual({ kind: 'target-stale' })
    expect(captureSnapshotForUser).not.toHaveBeenCalled()
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('commits admission with the canonical branch for an existing worktree target', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const commitAdmission = vi.fn()
    const repository = memoryRepository()
    repository.load = vi.fn(repository.load)
    repository.compareAndSwap = vi.fn(repository.compareAndSwap)
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(repository),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: {
        ...testTargetProjection([
          {
            workspaceId: WORKSPACE_ID,
            branchName: 'feature/renamed',
            worktreePath: '/repo/worktree',
          },
        ]),
      },
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            workspaceId: WORKSPACE_ID,
            branchName: 'feature/old',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted.admitted).toBe(true)
    expect(commitAdmission).toHaveBeenCalledWith('feature/renamed')
    expect(commitAdmission).toHaveBeenCalledTimes(1)
    expect(repository.load).toHaveBeenCalledTimes(1)
    expect(repository.compareAndSwap).not.toHaveBeenCalled()
  })

  test('does not expose staged runtime state when terminal admission fails', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const aggregate = aggregateFor(memoryRepository())
    const projection = testRuntimeTargetProjection({
      workspaceId: WORKSPACE_ID,
      branchName: 'main',
      worktreePath: '/repo/worktree',
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    await expect(
      operations.runOperation(
        capability,
        async (permit) =>
          await coordinator.ensureRuntimeTabForSession({
            userId: 'user-a',
            target: projection.target,
            worktreePath: '/repo/worktree',
            runtimeType: 'terminal',
            sessionId: 'term-admissionfailure0001',
            insertAfterIdentity: 'workspace-pane:status',
            permit,
            physicalWorktreeCapability: capability,
            epochCapability: TEST_MEMBERSHIP_CAPABILITY,
            commitAdmission: () => {
              throw new Error('terminal admission failed')
            },
          }),
      ),
    ).rejects.toThrow('terminal admission failed')
    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])
    await expect(
      coordinator.listWorkspaceTabs({
        userId: 'user-a',
        workspaceId: WORKSPACE_ID,
        scope: 'goblin+file:///repo\0runtime-a',
        epochCapability: TEST_MEMBERSHIP_CAPABILITY,
      }),
    ).resolves.toMatchObject({
      revision: 0,
      entries: [],
    })
  })

  test('does not commit admission or ghost runtime state when staged snapshot preparation fails', async () => {
    let loads = 0
    const repository = memoryRepository()
    const originalLoad = repository.load
    repository.load = async (workspaceId) => {
      loads += 1
      if (loads === 1) throw new Error('snapshot preparation failed')
      return await originalLoad(workspaceId)
    }
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const aggregate = aggregateFor(repository)
    const projection = testRuntimeTargetProjection({
      workspaceId: WORKSPACE_ID,
      branchName: 'main',
      worktreePath: '/repo/worktree',
    })
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    await expect(
      operations.runOperation(
        capability,
        async (permit) =>
          await coordinator.ensureRuntimeTabForSession({
            userId: 'user-a',
            target: projection.target,
            worktreePath: '/repo/worktree',
            runtimeType: 'terminal',
            sessionId: 'term-snapshotfailure0001',
            permit,
            physicalWorktreeCapability: capability,
            epochCapability: TEST_MEMBERSHIP_CAPABILITY,
            commitAdmission,
          }),
      ),
    ).rejects.toThrow('snapshot preparation failed')
    expect(commitAdmission).not.toHaveBeenCalled()
    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])
  })

  test('commits workspace terminal admission without inventing a branch', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const workspaceId = canonicalWorkspaceLocator(WORKSPACE_ID)!
    const projection: WorkspacePaneTargetProjection = {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: 'runtime-a' },
      nativeWorktreePath: '/repo',
      canonicalBranch: null,
    }
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: projection.target,
          worktreePath: '/repo',
          runtimeType: 'terminal',
          sessionId: 'term-workspaceworkspace001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({
      admitted: true,
      value: {
        kind: 'committed',
        snapshot: {
          revision: 0,
          entries: [
            {
              target: projection.target,
              tabs: [
                workspacePaneStaticTabEntry('status'),
                workspacePaneRuntimeTabEntry('terminal', 'term-workspaceworkspace001'),
              ],
            },
          ],
        },
      },
    })
    expect(commitAdmission).toHaveBeenCalledWith(null)
  })

  test('commits detached worktree terminal admission without requiring a branch projection', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/detached', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const workspaceId = canonicalWorkspaceLocator(WORKSPACE_ID)!
    const root = canonicalWorkspaceLocator('goblin+file:///repo/detached')!
    const projection: WorkspacePaneTargetProjection = {
      target: { kind: 'git-worktree', workspaceId, workspaceRuntimeId: 'runtime-a', root },
      nativeWorktreePath: '/repo/detached',
      canonicalBranch: null,
    }
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: projection.target,
          worktreePath: '/repo/detached',
          runtimeType: 'terminal',
          sessionId: 'term-detacheddetached001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted).toMatchObject({ admitted: true, value: { kind: 'committed' } })
    expect(commitAdmission).toHaveBeenCalledWith(null)
  })

  test('keeps logical workspace membership independent from its physical realpath identity', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
      worktreePath: '/repo',
    })
    const workspaceId = canonicalWorkspaceLocator(WORKSPACE_ID)!
    const projection: WorkspacePaneTargetProjection = {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: 'runtime-a' },
      nativeWorktreePath: '/repo',
      canonicalBranch: null,
    }
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: projection.target,
          worktreePath: '/repo',
          runtimeType: 'terminal',
          sessionId: 'term-workspaceworkspace002',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({
      admitted: true,
      value: {
        kind: 'committed',
        snapshot: {
          revision: 0,
          entries: [
            {
              target: projection.target,
              tabs: [
                workspacePaneStaticTabEntry('status'),
                workspacePaneRuntimeTabEntry('terminal', 'term-workspaceworkspace002'),
              ],
            },
          ],
        },
      },
    })
    expect(commitAdmission).toHaveBeenCalledWith(null)
  })

  test('rejects placement metadata that does not belong to the runtime target', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/other', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const projection = testRuntimeTargetProjection({
      workspaceId: WORKSPACE_ID,
      branchName: 'main',
      worktreePath: '/repo/worktree',
    })
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: projection.target,
          worktreePath: '/repo/other',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({ admitted: true, value: { kind: 'target-stale' } })
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('rejects a same-path capability owned by another user or runtime', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-b',
    })
    const projection = testRuntimeTargetProjection({
      workspaceId: WORKSPACE_ID,
      branchName: 'main',
      worktreePath: '/repo/worktree',
    })
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets: async () => [projection] },
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: projection.target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({ admitted: true, value: { kind: 'runtime-stale' } })
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('fences a runtime invalidated after the single target-catalog capture', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const targets: TestWorkspacePaneTarget[] = [
      {
        workspaceId: WORKSPACE_ID,
        branchName: 'feature/current',
        worktreePath: '/repo/worktree',
      },
    ]
    const captureTargets = vi.fn(async () => targets.map(testRuntimeTargetProjection))
    let runtimeCurrent = true
    let releaseProvider!: () => void
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    let providerStarted = false
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            providerStarted = true
            await providerGate
            return { revision: 0, liveSessions: [] }
          },
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets },
    })

    const admitted = operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            workspaceId: WORKSPACE_ID,
            branchName: 'feature/current',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: {
            ...TEST_MEMBERSHIP_CAPABILITY,
            assertCurrent: () => {
              if (!runtimeCurrent) throw new Error('error.workspace-runtime-stale')
            },
          },
          commitAdmission,
        }),
    )
    await vi.waitFor(() => expect(providerStarted).toBe(true))
    runtimeCurrent = false
    releaseProvider()

    await expect(admitted).rejects.toThrow('error.workspace-runtime-stale')
    expect(captureTargets).toHaveBeenCalledOnce()
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('uses one immutable target-catalog capture throughout placement', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    let targets: TestWorkspacePaneTarget[] = [
      {
        workspaceId: WORKSPACE_ID,
        branchName: 'feature/old',
        worktreePath: '/repo/worktree',
      },
    ]
    const captureTargets = vi.fn(async () => targets.map(testRuntimeTargetProjection))
    let releaseProvider!: () => void
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    let providerStarted = false
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            providerStarted = true
            await providerGate
            return { revision: 0, liveSessions: [] }
          },
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: { captureTargets },
    })

    const admitted = operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            workspaceId: WORKSPACE_ID,
            branchName: 'feature/old',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          epochCapability: TEST_MEMBERSHIP_CAPABILITY,
          commitAdmission,
        }),
    )
    await vi.waitFor(() => expect(providerStarted).toBe(true))
    targets = [{ workspaceId: WORKSPACE_ID, branchName: 'feature/renamed', worktreePath: '/repo/worktree' }]
    releaseProvider()

    await expect(admitted).resolves.toEqual({
      admitted: true,
      value: {
        kind: 'committed',
        snapshot: {
          revision: 0,
          entries: [
            {
              target: testRuntimeTargetProjection({
                workspaceId: WORKSPACE_ID,
                branchName: 'feature/old',
                worktreePath: '/repo/worktree',
              }).target,
              tabs: [
                workspacePaneStaticTabEntry('status'),
                workspacePaneRuntimeTabEntry('terminal', 'term-preparedprepared001'),
              ],
            },
          ],
        },
      },
    })
    expect(captureTargets).toHaveBeenCalledOnce()
    expect(commitAdmission).toHaveBeenCalledWith('feature/old')
  })

  test('serializes repository reads with a later durable command', async () => {
    let layout: WorkspacePaneDurableLayout = {
      entries: [
        {
          target: { kind: 'git-branch', branch: 'main' },
          tabs: [workspacePaneStaticTabEntry('status')],
        },
      ],
    }
    const firstLoadStarted = Promise.withResolvers<void>()
    const firstLoad = Promise.withResolvers<void>()
    let loadCount = 0
    let blockLoad = false
    const repository: WorkspacePaneLayoutRepository = {
      async load() {
        loadCount += 1
        if (blockLoad && loadCount === 1) {
          firstLoadStarted.resolve()
          await firstLoad.promise
        }
        return { layout: structuredClone(layout) }
      },
      async compareAndSwap(input) {
        if (JSON.stringify(layout) !== JSON.stringify(input.expected)) {
          return { kind: 'conflict', snapshot: { layout: structuredClone(layout) } }
        }
        layout = structuredClone(input.replacement)
        return { kind: 'accepted', changed: true, snapshot: { layout: structuredClone(layout) } }
      },
    }
    const aggregate = aggregateFor(repository)
    await aggregate.runExclusive(
      WORKSPACE_ID,
      async (operation) =>
        await operation.validateMembershipAndSnapshot({
          userId: 'user-a',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'runtime-a',
          validTargets: [
            testRuntimeTargetProjection({
              workspaceId: WORKSPACE_ID,
              branchName: 'main',
              worktreePath: null,
            }),
          ],
          physicalTargets: [],
          expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
          providerSnapshots: [],
          epochCapability: TEST_EPOCH_CAPABILITY,
        }),
    )
    loadCount = 0
    blockLoad = true
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      targetProjection: testTargetProjection([{ kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'main' }]),
    })
    const input = {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      scope: 'goblin+file:///repo\0runtime-a',
      epochCapability: TEST_MEMBERSHIP_CAPABILITY,
    }
    const list = coordinator.listWorkspaceTabs(input)
    await firstLoadStarted.promise
    let updateSettled = false
    const update = coordinator
      .updateTabs({
        ...input,
        target: testRuntimeTargetProjection({
          workspaceId: WORKSPACE_ID,
          branchName: 'main',
          worktreePath: null,
        }).target,
        nativeWorktreePath: null,
        operation: { type: 'open-static' as const, tabType: 'history' as const },
      })
      .finally(() => {
        updateSettled = true
      })

    await waitForNextMacrotask()
    expect(updateSettled).toBe(false)
    firstLoad.resolve()

    await expect(list).resolves.toMatchObject({
      revision: 1,
      entries: [{ tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')] }],
    })
    await expect(update).resolves.toMatchObject({
      snapshot: {
        entries: [{ tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')] }],
      },
    })
  })
})
