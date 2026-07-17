// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  WorkspacePaneLayoutAggregate,
  type WorkspacePaneTargetProjection,
} from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import type { WorkspacePaneLayoutRestoreTransaction } from '#/server/workspace-pane/workspace-pane-layout-restore-transaction.ts'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

describe('workspace pane tabs coordinator queues', () => {
  test('does not commit admission when the target projection no longer contains the worktree', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
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
            repoRoot: 'goblin+file:///repo',
            branchName: 'main',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          insertAfterIdentity: 'workspace-pane:status',
          permit,
          physicalWorktreeCapability: capability,
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )

    expect(admitted.admitted).toBe(true)
    if (!admitted.admitted) return
    expect(admitted.value).toEqual({ kind: 'runtime-stale' })
    expect(captureSnapshotForUser).not.toHaveBeenCalled()
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('commits admission with the canonical branch for an existing worktree target', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    const commitAdmission = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: testTargetProjection([
        {
          repoRoot: 'goblin+file:///repo',
          branchName: 'feature/renamed',
          worktreePath: '/repo/worktree',
        },
      ]),
    })

    const admitted = await operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            repoRoot: 'goblin+file:///repo',
            branchName: 'feature/old',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )

    expect(admitted.admitted).toBe(true)
    expect(commitAdmission).toHaveBeenCalledWith('feature/renamed')
  })

  test('commits workspace terminal admission without inventing a branch', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    const workspaceId = canonicalWorkspaceLocator('goblin+file:///repo')!
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
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({
      admitted: true,
      value: {
        kind: 'committed',
        snapshot: {
          revision: 1,
          entries: [
            {
              target: projection.target,
              tabs: [
                workspacePaneStaticTabEntry('status'),
                workspacePaneStaticTabEntry('files'),
                workspacePaneRuntimeTabEntry('terminal', 'term-workspaceworkspace001'),
              ],
            },
          ],
        },
      },
    })
    expect(commitAdmission).toHaveBeenCalledWith(null)
  })

  test('keeps logical workspace membership independent from its physical realpath identity', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/private/repo', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
      worktreePath: '/repo',
    })
    const workspaceId = canonicalWorkspaceLocator('goblin+file:///repo')!
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
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({
      admitted: true,
      value: {
        kind: 'committed',
        snapshot: {
          revision: 1,
          entries: [
            {
              target: projection.target,
              tabs: [
                workspacePaneStaticTabEntry('status'),
                workspacePaneStaticTabEntry('files'),
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
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    const projection = testRuntimeTargetProjection({
      repoRoot: 'goblin+file:///repo',
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
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({ admitted: true, value: { kind: 'runtime-stale' } })
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('rejects a same-path capability owned by another user or runtime', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-b',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-b',
    })
    const projection = testRuntimeTargetProjection({
      repoRoot: 'goblin+file:///repo',
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
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )

    expect(admitted).toEqual({ admitted: true, value: { kind: 'runtime-stale' } })
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('does not commit when the target disappears during placement preparation', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    let targets = [{ repoRoot: 'goblin+file:///repo', branchName: 'feature/current', worktreePath: '/repo/worktree' }]
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
      targetProjection: { captureTargets: async () => targets.map(testRuntimeTargetProjection) },
    })

    const admitted = operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            repoRoot: 'goblin+file:///repo',
            branchName: 'feature/current',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )
    await vi.waitFor(() => expect(providerStarted).toBe(true))
    targets = []
    releaseProvider()

    await expect(admitted).resolves.toEqual({ admitted: true, value: { kind: 'runtime-stale' } })
    expect(commitAdmission).not.toHaveBeenCalled()
  })

  test('commits the latest canonical branch after placement preparation', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    let targets = [{ repoRoot: 'goblin+file:///repo', branchName: 'feature/old', worktreePath: '/repo/worktree' }]
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
      targetProjection: { captureTargets: async () => targets.map(testRuntimeTargetProjection) },
    })

    const admitted = operations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          userId: 'user-a',
          target: testRuntimeTargetProjection({
            repoRoot: 'goblin+file:///repo',
            branchName: 'feature/old',
            worktreePath: '/repo/worktree',
          }).target,
          worktreePath: '/repo/worktree',
          runtimeType: 'terminal',
          sessionId: 'term-preparedprepared001',
          permit,
          physicalWorktreeCapability: capability,
          isRuntimeCurrent: () => true,
          commitAdmission,
        }),
    )
    await vi.waitFor(() => expect(providerStarted).toBe(true))
    targets = [{ repoRoot: 'goblin+file:///repo', branchName: 'feature/renamed', worktreePath: '/repo/worktree' }]
    releaseProvider()

    await expect(admitted).resolves.toEqual({
      admitted: true,
      value: {
        kind: 'committed',
        snapshot: {
          revision: 1,
          entries: [
            {
              target: testRuntimeTargetProjection({
                repoRoot: 'goblin+file:///repo',
                branchName: 'feature/renamed',
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
    expect(commitAdmission).toHaveBeenCalledWith('feature/renamed')
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
    let releaseFirstLoad!: () => void
    const firstLoad = new Promise<void>((resolve) => {
      releaseFirstLoad = resolve
    })
    let loadCount = 0
    let blockLoad = false
    const repository: WorkspacePaneLayoutRepository = {
      async load() {
        loadCount += 1
        if (blockLoad && loadCount === 1) await firstLoad
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
      '/repo',
      async (operation) =>
        await operation.validateMembershipAndSnapshot({
          userId: 'user-a',
          repoRoot: 'goblin+file:///repo',
          repoRuntimeId: 'runtime-a',
          validTargets: [
            testRuntimeTargetProjection({
              repoRoot: 'goblin+file:///repo',
              branchName: 'main',
              worktreePath: null,
            }),
          ],
          physicalTargets: [],
          expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
          providerSnapshots: [],
        }),
    )
    loadCount = 0
    blockLoad = true
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      targetProjection: testTargetProjection([
        { repoRoot: 'goblin+file:///repo', branchName: 'main', worktreePath: null },
      ]),
    })
    const input = {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    }
    const list = coordinator.listWorkspaceTabs(input)
    await vi.waitFor(() => expect(loadCount).toBe(1))
    let updateSettled = false
    const update = coordinator
      .updateTabs({
        ...input,
        target: testRuntimeTargetProjection({
          repoRoot: 'goblin+file:///repo',
          branchName: 'main',
          worktreePath: null,
        }).target,
        nativeWorktreePath: null,
        operation: { type: 'open-static' as const, tabType: 'history' as const },
      })
      .finally(() => {
        updateSettled = true
      })

    await Promise.resolve()
    expect(updateSettled).toBe(false)
    releaseFirstLoad()

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

  test('registers restored worktree targets in the physical reverse index', async () => {
    const repository = memoryRepository()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(repository),
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      targetProjection: testTargetProjection([]),
    })

    await coordinator.restoreScope({
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      targets: [
        testRuntimeTargetProjection({
          repoRoot: 'goblin+file:///repo',
          branchName: 'main',
          worktreePath: '/repo/worktree',
        }),
      ],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      assertCurrent: () => {},
    })

    expect(coordinator.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo/worktree'))).toEqual([
      {
        userId: 'user-a',
        scope: 'goblin+file:///repo\0runtime-a',
        repoRuntimeId: 'runtime-a',
        target: testRuntimeTargetProjection({
          repoRoot: 'goblin+file:///repo',
          branchName: 'main',
          worktreePath: '/repo/worktree',
        }).target,
      },
    ])
  })

  test('commits no epoch or physical index when restore membership conflicts', async () => {
    const repository: WorkspacePaneLayoutRepository = {
      async load() {
        return { layout: { entries: [] } }
      },
      async compareAndSwap() {
        return { kind: 'accepted', changed: false, snapshot: { layout: { entries: [] } } }
      },
    }
    const aggregate = new WorkspacePaneLayoutAggregate({
      repository,
      restoreTransaction: {
        async validateMembershipAndLoad() {
          return { kind: 'membership-conflict', snapshot: { layout: { entries: [] } } }
        },
      },
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      targetProjection: testTargetProjection([]),
    })

    await expect(
      coordinator.restoreScope({
        userId: 'user-a',
        repoRoot: 'goblin+file:///repo',
        scope: 'goblin+file:///repo\0runtime-a',
        targets: [
          testRuntimeTargetProjection({
            repoRoot: 'goblin+file:///repo',
            branchName: 'main',
            worktreePath: '/repo/worktree',
          }),
        ],
        expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
        assertCurrent: () => {},
      }),
    ).resolves.toEqual({ kind: 'membership-conflict' })

    expect(aggregate.activeEpochs('/repo')).toEqual([])
    expect(coordinator.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo/worktree'))).toEqual([])
  })

  test('does not validate or index restore targets while physical removal is admitted', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    let releaseRemoval!: () => void
    const removalGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve
    })
    const removal = operations.runRemoval(capability, async () => {
      await removalGate
    })
    await vi.waitFor(() => expect(operations.isRemovalAdmitted(capability)).toBe(true))
    const aggregate = aggregateFor(memoryRepository())
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: testTargetProjection([]),
    })

    await expect(
      coordinator.restoreScope({
        userId: 'user-a',
        repoRoot: 'goblin+file:///repo',
        scope: 'goblin+file:///repo\0runtime-a',
        targets: [
          testRuntimeTargetProjection({
            repoRoot: 'goblin+file:///repo',
            branchName: 'main',
            worktreePath: '/repo/worktree',
          }),
        ],
        expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('error.worktree-removal-in-progress')
    expect(aggregate.activeEpochs('/repo')).toEqual([])
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])

    releaseRemoval()
    await removal
  })

  test('holds physical admission through the final provider sample and snapshot', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    let releaseFinalSample!: () => void
    const finalSampleGate = new Promise<void>((resolve) => {
      releaseFinalSample = resolve
    })
    let captureCount = 0
    let finalSampleStarted = false
    const aggregate = aggregateFor(memoryRepository())
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            captureCount += 1
            if (captureCount === 2) {
              finalSampleStarted = true
              await finalSampleGate
            }
            return {
              revision: captureCount,
              liveSessions: [
                {
                  sessionId: 'term-physicalphysicalphy1',
                  target: testRuntimeTargetProjection({
                    repoRoot: 'goblin+file:///repo',
                    branchName: 'main',
                    worktreePath: '/repo/worktree',
                  }).target,
                  branch: 'main',
                  worktreePath: '/repo/worktree',
                },
              ],
            }
          },
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: { capture: async () => capability },
      targetProjection: testTargetProjection([]),
    })
    const list = coordinator.listWorkspaceTabs({
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    })
    await vi.waitFor(() => expect(finalSampleStarted).toBe(true))
    let removalTaskStarted = false
    const removal = operations.runRemoval(capability, async () => {
      removalTaskStarted = true
    })
    await Promise.resolve()
    expect(removalTaskStarted).toBe(false)

    releaseFinalSample()
    await expect(list).resolves.toMatchObject({
      entries: [{ target: { kind: 'git-worktree', root: 'goblin+file:///repo/worktree' } }],
    })
    await expect(removal).resolves.toEqual({ admitted: false })
    await expect(
      operations.runRemoval(capability, async () => {
        removalTaskStarted = true
      }),
    ).resolves.toMatchObject({ admitted: true })
    expect(removalTaskStarted).toBe(true)
  })

  test('retries admission when the authoritative provider sample adds a physical worktree', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capabilityA = testPhysicalWorktreeExecutionCapability('/repo/worktree-a', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    const capabilityC = testPhysicalWorktreeExecutionCapability('/repo/worktree-c', {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
    })
    let releaseStableSample!: () => void
    const stableSampleGate = new Promise<void>((resolve) => {
      releaseStableSample = resolve
    })
    let captureCount = 0
    let stableSampleStarted = false
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            captureCount += 1
            if (captureCount === 3) {
              stableSampleStarted = true
              await stableSampleGate
            }
            return {
              revision: captureCount,
              liveSessions: [
                {
                  sessionId: 'term-worktreeaaaaaaaaa1',
                  target: testRuntimeTargetProjection({
                    repoRoot: 'goblin+file:///repo',
                    branchName: 'a',
                    worktreePath: '/repo/worktree-a',
                  }).target,
                  branch: 'a',
                  worktreePath: '/repo/worktree-a',
                },
                ...(captureCount >= 2
                  ? [
                      {
                        sessionId: 'term-worktreeccccccccc1',
                        target: testRuntimeTargetProjection({
                          repoRoot: 'goblin+file:///repo',
                          branchName: 'c',
                          worktreePath: '/repo/worktree-c',
                        }).target,
                        branch: 'c',
                        worktreePath: '/repo/worktree-c',
                      },
                    ]
                  : []),
              ],
            }
          },
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: {
        capture: async ({ worktreePath }) => (worktreePath === '/repo/worktree-a' ? capabilityA : capabilityC),
      },
      targetProjection: testTargetProjection([]),
    })

    const list = coordinator.listWorkspaceTabs({
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    })
    await vi.waitFor(() => expect(stableSampleStarted).toBe(true))
    let removalStarted = false
    const removal = operations.runRemoval(capabilityC, async () => {
      removalStarted = true
    })
    await Promise.resolve()
    expect(removalStarted).toBe(false)

    releaseStableSample()
    await expect(list).resolves.toMatchObject({
      entries: [
        { target: { kind: 'git-worktree', root: 'goblin+file:///repo/worktree-a' } },
        { target: { kind: 'git-worktree', root: 'goblin+file:///repo/worktree-c' } },
      ],
    })
    expect(coordinator.physicalWorktreeTargets(capabilityC.identity)).toEqual([
      {
        userId: 'user-a',
        scope: 'goblin+file:///repo\0runtime-a',
        repoRuntimeId: 'runtime-a',
        target: testRuntimeTargetProjection({
          repoRoot: 'goblin+file:///repo',
          branchName: 'c',
          worktreePath: '/repo/worktree-c',
        }).target,
      },
    ])
    await expect(removal).resolves.toEqual({ admitted: false })
    await expect(
      operations.runRemoval(capabilityC, async () => {
        removalStarted = true
      }),
    ).resolves.toMatchObject({ admitted: true })
    expect(removalStarted).toBe(true)
    expect(captureCount).toBe(3)
  })

  test('holds the old physical permit while removing a stale projection index', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    let live = true
    let executionExists = true
    const capability = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity('/repo/worktree-x'),
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
      worktreePath: '/repo/worktree-x',
      validateExecution: async () => {
        if (!executionExists) throw new Error('ENOENT')
      },
    })
    let revision = 0
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            revision += 1
            return {
              revision,
              liveSessions: live
                ? [
                    {
                      sessionId: 'term-worktreexxxxxxxxx1',
                      target: testRuntimeTargetProjection({
                        repoRoot: 'goblin+file:///repo',
                        branchName: 'x',
                        worktreePath: '/repo/worktree-x',
                      }).target,
                      branch: 'x',
                      worktreePath: '/repo/worktree-x',
                    },
                  ]
                : [],
            }
          },
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: {
        capture: vi.fn(async () => {
          if (!live) throw new Error('worktree path no longer exists')
          return capability
        }),
      },
      targetProjection: testTargetProjection([]),
    })
    const input = {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    }
    await coordinator.listWorkspaceTabs(input)
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toHaveLength(1)

    live = false
    let releaseRemoval!: () => void
    const removalGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve
    })
    const removal = operations.runRemoval(capability, async () => await removalGate)
    await vi.waitFor(() => expect(operations.isRemovalAdmitted(capability)).toBe(true))

    await expect(coordinator.listWorkspaceTabs(input)).rejects.toThrow('error.worktree-removal-in-progress')
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toHaveLength(1)

    releaseRemoval()
    await removal
    executionExists = false
    await expect(coordinator.listWorkspaceTabs(input)).resolves.toMatchObject({ entries: [] })
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])
  })

  test('restore holds an indexed stale target permit before removing its physical ref', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    let live = true
    let executionExists = true
    const capability = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity('/repo/worktree-x'),
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      repoRuntimeId: 'runtime-a',
      worktreePath: '/repo/worktree-x',
      validateExecution: async () => {
        if (!executionExists) throw new Error('ENOENT')
      },
    })
    let revision = 0
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            revision += 1
            return {
              revision,
              liveSessions: live
                ? [
                    {
                      sessionId: 'term-worktreexxxxxxxxx1',
                      target: testRuntimeTargetProjection({
                        repoRoot: 'goblin+file:///repo',
                        branchName: 'x',
                        worktreePath: '/repo/worktree-x',
                      }).target,
                      branch: 'x',
                      worktreePath: '/repo/worktree-x',
                    },
                  ]
                : [],
            }
          },
        },
      ],
      worktreeOperations: operations,
      physicalWorktrees: {
        capture: vi.fn(async () => {
          if (!live) throw new Error('worktree path no longer exists')
          return capability
        }),
      },
      targetProjection: testTargetProjection([]),
    })
    const listInput = {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    }
    await coordinator.listWorkspaceTabs(listInput)

    live = false
    let releaseRemoval!: () => void
    const removalGate = new Promise<void>((resolve) => {
      releaseRemoval = resolve
    })
    const removal = operations.runRemoval(capability, async () => await removalGate)
    await vi.waitFor(() => expect(operations.isRemovalAdmitted(capability)).toBe(true))
    const restore = coordinator.restoreScope({
      ...listInput,
      targets: [],
      expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
    })
    await expect(restore).rejects.toThrow('error.worktree-removal-in-progress')
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toHaveLength(1)

    releaseRemoval()
    await removal
    executionExists = false
    await expect(
      coordinator.restoreScope({
        ...listInput,
        targets: [],
        expectedRepoEntry: { kind: 'local', id: 'goblin+file:///repo' },
      }),
    ).resolves.toMatchObject({ kind: 'validated' })
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])
  })

  test('strictly validates the current capability when an indexed alias has the same identity', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree-x')
    let oldValid = true
    let currentValidationCount = 0
    const oldCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      worktreePath: '/repo/worktree-x',
      validateExecution: async () => {
        if (!oldValid) throw new Error('stale physical generation')
      },
    })
    const currentCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      worktreePath: '/repo/worktree-alias',
      validateExecution: async () => {
        currentValidationCount += 1
      },
    })
    let useCurrentCapability = false
    let revision = 0
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            revision += 1
            return {
              revision,
              liveSessions: [
                {
                  sessionId: 'term-worktreexxxxxxxxx1',
                  target: testRuntimeTargetProjection({
                    repoRoot: 'goblin+file:///repo',
                    branchName: 'x',
                    worktreePath: '/repo/worktree-alias',
                  }).target,
                  branch: 'x',
                  worktreePath: '/repo/worktree-alias',
                },
              ],
            }
          },
        },
      ],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: {
        capture: async () => (useCurrentCapability ? currentCapability : oldCapability),
      },
      targetProjection: testTargetProjection([]),
    })
    const input = {
      userId: 'user-a',
      repoRoot: 'goblin+file:///repo',
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    }
    await coordinator.listWorkspaceTabs(input)

    oldValid = false
    useCurrentCapability = true
    await expect(coordinator.listWorkspaceTabs(input)).resolves.toMatchObject({
      entries: [{ target: { kind: 'git-worktree', root: 'goblin+file:///repo/worktree-alias' } }],
    })
    expect(currentValidationCount).toBeGreaterThan(0)
  })
})

function memoryRepository(initial: WorkspacePaneDurableLayout = { entries: [] }): WorkspacePaneLayoutRepository {
  let layout: WorkspacePaneDurableLayout = initial
  return {
    async load() {
      return { layout: structuredClone(layout) }
    },
    async compareAndSwap(input) {
      const changed = JSON.stringify(layout) !== JSON.stringify(input.replacement)
      layout = structuredClone(input.replacement)
      return { kind: 'accepted', changed, snapshot: { layout: structuredClone(layout) } }
    },
  }
}

function aggregateFor(
  repository: WorkspacePaneLayoutRepository,
  restoreTransaction: WorkspacePaneLayoutRestoreTransaction = {
    async validateMembershipAndLoad(input) {
      const current = await repository.load(input.repoRoot)
      return { kind: 'accepted' as const, snapshot: current }
    },
  },
): WorkspacePaneLayoutAggregate {
  return new WorkspacePaneLayoutAggregate({ repository, restoreTransaction })
}

function testTargetProjection(
  targets: readonly { repoRoot: string; branchName: string; worktreePath: string | null }[],
) {
  return { captureTargets: async () => targets.map(testRuntimeTargetProjection) }
}

function testRuntimeTargetProjection(target: {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}): WorkspacePaneTargetProjection {
  const workspaceId = canonicalWorkspaceLocator(target.repoRoot)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  if (target.worktreePath === null) {
    return {
      target: { kind: 'git-branch', workspaceId, workspaceRuntimeId: 'runtime-a', branch: target.branchName },
      nativeWorktreePath: null,
      canonicalBranch: target.branchName,
    }
  }
  const root = canonicalWorkspaceLocator(`goblin+file://${target.worktreePath}`)
  if (!root) throw new Error('invalid worktree locator fixture')
  return {
    target: { kind: 'git-worktree', workspaceId, workspaceRuntimeId: 'runtime-a', root },
    nativeWorktreePath: target.worktreePath,
    canonicalBranch: target.branchName,
  }
}
