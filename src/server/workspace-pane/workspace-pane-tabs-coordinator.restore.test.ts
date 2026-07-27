// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  WorkspacePaneLayoutAggregate,
  type WorkspacePaneTargetProjection,
} from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  issueTestPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeExecutionCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  WORKSPACE_ID,
  LOCAL_WORKSPACE_ENTRY,
  memoryRepository,
  aggregateFor,
  testTargetProjection,
  testRuntimeTargetProjection,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.test-utils.ts'

describe('workspace pane tabs coordinator restore queues', () => {
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
      workspaceId: WORKSPACE_ID,
      scope: 'goblin+file:///repo\0runtime-a',
      targets: [
        testRuntimeTargetProjection({
          workspaceId: WORKSPACE_ID,
          branchName: 'main',
          worktreePath: '/repo/worktree',
        }),
      ],
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      assertCurrent: () => {},
    })

    expect(coordinator.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo/worktree'))).toEqual([
      {
        userId: 'user-a',
        scope: 'goblin+file:///repo\0runtime-a',
        workspaceRuntimeId: 'runtime-a',
        target: testRuntimeTargetProjection({
          workspaceId: WORKSPACE_ID,
          branchName: 'main',
          worktreePath: '/repo/worktree',
        }).target,
      },
    ])
  })

  test('projects workspace-root independently without deleting deferred Git layout', async () => {
    const repository = memoryRepository({
      entries: [
        { target: { kind: 'workspace-root' }, tabs: [workspacePaneStaticTabEntry('status')] },
        { target: { kind: 'git-branch', branch: 'feature/deferred' }, tabs: [workspacePaneStaticTabEntry('history')] },
      ],
    })
    const rootProjection: WorkspacePaneTargetProjection = {
      target: {
        kind: 'workspace-root',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: 'runtime-a',
      },
      nativeWorktreePath: null,
      canonicalBranch: null,
    }
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(repository),
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      targetProjection: { captureTargets: async () => [rootProjection] },
    })
    const scope = {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    }

    await expect(
      coordinator.restoreScope({
        ...scope,
        targets: [rootProjection],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      }),
    ).resolves.toMatchObject({
      kind: 'validated',
      snapshot: { entries: [{ target: { kind: 'workspace-root' } }] },
    })
    await coordinator.updateTabs({
      ...scope,
      target: rootProjection.target,
      nativeWorktreePath: null,
      operation: { type: 'open-static', tabType: 'files' },
    })

    expect((await repository.load(WORKSPACE_ID)).layout.entries).toContainEqual({
      target: { kind: 'git-branch', branch: 'feature/deferred' },
      tabs: [workspacePaneStaticTabEntry('history')],
    })
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
        workspaceId: WORKSPACE_ID,
        scope: 'goblin+file:///repo\0runtime-a',
        targets: [
          testRuntimeTargetProjection({
            workspaceId: WORKSPACE_ID,
            branchName: 'main',
            worktreePath: '/repo/worktree',
          }),
        ],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
        assertCurrent: () => {},
      }),
    ).resolves.toEqual({ kind: 'membership-conflict' })

    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
    expect(coordinator.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo/worktree'))).toEqual([])
  })

  test('does not validate or index restore targets while physical removal is admitted', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
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
        workspaceId: WORKSPACE_ID,
        scope: 'goblin+file:///repo\0runtime-a',
        targets: [
          testRuntimeTargetProjection({
            workspaceId: WORKSPACE_ID,
            branchName: 'main',
            worktreePath: '/repo/worktree',
          }),
        ],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('error.worktree-removal-in-progress')
    expect(aggregate.activeEpochs(WORKSPACE_ID)).toEqual([])
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])

    releaseRemoval()
    await removal
  })

  test('holds physical admission through the final provider sample and snapshot', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeExecutionCapability('/repo/worktree', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const finalSampleStarted = Promise.withResolvers<void>()
    const finalSampleGate = Promise.withResolvers<void>()
    let captureCount = 0
    const aggregate = aggregateFor(memoryRepository())
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            captureCount += 1
            if (captureCount === 2) {
              finalSampleStarted.resolve()
              await finalSampleGate.promise
            }
            return {
              revision: captureCount,
              liveSessions: [
                {
                  sessionId: 'term-physicalphysicalphy1',
                  target: testRuntimeTargetProjection({
                    workspaceId: WORKSPACE_ID,
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
      workspaceId: WORKSPACE_ID,
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    })
    await finalSampleStarted.promise
    let removalTaskStarted = false
    const removal = operations.runRemoval(capability, async () => {
      removalTaskStarted = true
    })
    expect(removalTaskStarted).toBe(false)

    finalSampleGate.resolve()
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
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const capabilityC = testPhysicalWorktreeExecutionCapability('/repo/worktree-c', {
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
    })
    const stableSampleStarted = Promise.withResolvers<void>()
    const stableSampleGate = Promise.withResolvers<void>()
    let captureCount = 0
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregateFor(memoryRepository()),
      runtimeProviders: [
        {
          type: 'terminal',
          async captureSnapshotForUser() {
            captureCount += 1
            if (captureCount === 3) {
              stableSampleStarted.resolve()
              await stableSampleGate.promise
            }
            return {
              revision: captureCount,
              liveSessions: [
                {
                  sessionId: 'term-worktreeaaaaaaaaa1',
                  target: testRuntimeTargetProjection({
                    workspaceId: WORKSPACE_ID,
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
                          workspaceId: WORKSPACE_ID,
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
      workspaceId: WORKSPACE_ID,
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    })
    await stableSampleStarted.promise
    let removalStarted = false
    const removal = operations.runRemoval(capabilityC, async () => {
      removalStarted = true
    })
    expect(removalStarted).toBe(false)

    stableSampleGate.resolve()
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
        workspaceRuntimeId: 'runtime-a',
        target: testRuntimeTargetProjection({
          workspaceId: WORKSPACE_ID,
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
    const capability = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity('/repo/worktree-x'),
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
      worktreePath: '/repo/worktree-x',
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
                        workspaceId: WORKSPACE_ID,
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
      workspaceId: WORKSPACE_ID,
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
    await expect(coordinator.listWorkspaceTabs(input)).resolves.toMatchObject({ entries: [] })
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])
  })

  test('restore holds an indexed stale target permit before removing its physical ref', async () => {
    const operations = createPhysicalWorktreeOperationCoordinator()
    let live = true
    const capability = issueTestPhysicalWorktreeExecutionCapability({
      identity: testPhysicalWorktreeIdentity('/repo/worktree-x'),
      userId: 'user-a',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'runtime-a',
      worktreePath: '/repo/worktree-x',
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
                        workspaceId: WORKSPACE_ID,
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
      workspaceId: WORKSPACE_ID,
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
      expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
    })
    await expect(restore).rejects.toThrow('error.worktree-removal-in-progress')
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toHaveLength(1)

    releaseRemoval()
    await removal
    await expect(
      coordinator.restoreScope({
        ...listInput,
        targets: [],
        expectedWorkspaceEntry: LOCAL_WORKSPACE_ENTRY,
      }),
    ).resolves.toMatchObject({ kind: 'validated' })
    expect(coordinator.physicalWorktreeTargets(capability.identity)).toEqual([])
  })

  test('rebinds an indexed alias to a fresh capability at the same stable identity', async () => {
    const identity = testPhysicalWorktreeIdentity('/repo/worktree-x')
    const oldCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      worktreePath: '/repo/worktree-x',
    })
    const currentCapability = issueTestPhysicalWorktreeExecutionCapability({
      identity,
      worktreePath: '/repo/worktree-alias',
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
                    workspaceId: WORKSPACE_ID,
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
      workspaceId: WORKSPACE_ID,
      scope: 'goblin+file:///repo\0runtime-a',
      assertCurrent: () => {},
    }
    await coordinator.listWorkspaceTabs(input)

    useCurrentCapability = true
    await expect(coordinator.listWorkspaceTabs(input)).resolves.toMatchObject({
      entries: [{ target: { kind: 'git-worktree', root: 'goblin+file:///repo/worktree-alias' } }],
    })
    expect(coordinator.physicalWorktreeTargets(identity)).toHaveLength(1)

    await coordinator.clearPhysicalWorktreeIndex(oldCapability)
    expect(coordinator.physicalWorktreeTargets(identity)).toHaveLength(1)
  })
})
