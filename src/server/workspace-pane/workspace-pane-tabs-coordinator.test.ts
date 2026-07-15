// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneLayoutAggregate } from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneLayoutRepository } from '#/server/workspace-pane/workspace-pane-layout-repository.ts'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneDurableLayout } from '#/shared/workspace-pane-tabs.ts'

describe('workspace pane tabs coordinator queues', () => {
  test('serializes repository reads with a later durable command', async () => {
    let layout: WorkspacePaneDurableLayout = { entries: [] }
    let releaseFirstLoad!: () => void
    const firstLoad = new Promise<void>((resolve) => { releaseFirstLoad = resolve })
    let loadCount = 0
    const repository: WorkspacePaneLayoutRepository = {
      async load() {
        loadCount += 1
        if (loadCount === 1) await firstLoad
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
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: new WorkspacePaneLayoutAggregate({ repository }),
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
    })
    const input = {
      userId: 'user-a',
      repoRoot: '/repo',
      scope: '/repo\0runtime-a',
      assertCurrent: () => {},
    }
    const list = coordinator.listWorkspaceTabs(input)
    await vi.waitFor(() => expect(loadCount).toBe(1))
    let updateSettled = false
    const update = coordinator.updateTabs({
      ...input,
      branchName: 'main',
      worktreePath: null,
      operation: { type: 'open-static' as const, tabType: 'history' as const },
    }).finally(() => { updateSettled = true })

    await Promise.resolve()
    expect(updateSettled).toBe(false)
    releaseFirstLoad()

    await expect(list).resolves.toMatchObject({
      revision: 1,
      entries: [{ tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')] }],
    })
    await expect(update).resolves.toMatchObject({
      entries: [{ tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')] }],
    })
  })

  test('registers restored worktree targets in the physical reverse index', async () => {
    const repository = memoryRepository()
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: new WorkspacePaneLayoutAggregate({ repository }),
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
    })

    await coordinator.restoreScope({
      userId: 'user-a',
      repoRoot: '/repo',
      scope: '/repo\0runtime-a',
      targets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: '/repo/worktree' }],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      assertCurrent: () => {},
    })

    expect(coordinator.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo/worktree'))).toEqual([{
      userId: 'user-a',
      scope: '/repo\0runtime-a',
      repoRuntimeId: 'runtime-a',
      target: { kind: 'worktree', repoRoot: '/repo', worktreePath: '/repo/worktree' },
    }])
  })

  test('commits no epoch or physical index when restore membership conflicts', async () => {
    const repository: WorkspacePaneLayoutRepository = {
      async load() {
        return { layout: { entries: [] } }
      },
      async compareAndSwap() {
        return { kind: 'membership-conflict', snapshot: { layout: { entries: [] } } }
      },
    }
    const aggregate = new WorkspacePaneLayoutAggregate({ repository })
    const coordinator = createWorkspacePaneTabsCoordinator({
      layoutAggregate: aggregate,
      runtimeProviders: [],
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
    })

    await expect(coordinator.restoreScope({
      userId: 'user-a',
      repoRoot: '/repo',
      scope: '/repo\0runtime-a',
      targets: [{ repoRoot: '/repo', branchName: 'main', worktreePath: '/repo/worktree' }],
      expectedRepoEntry: { kind: 'local', id: '/repo' },
      assertCurrent: () => {},
    })).resolves.toEqual({ kind: 'membership-conflict' })

    expect(aggregate.overlay.activeEpochs('/repo')).toEqual([])
    expect(aggregate.overlay.epochTargets({ userId: 'user-a', repoRoot: '/repo', repoRuntimeId: 'runtime-a' })).toEqual([])
    expect(coordinator.physicalWorktreeTargets(testPhysicalWorktreeIdentity('/repo/worktree'))).toEqual([])
  })
})

function memoryRepository(): WorkspacePaneLayoutRepository {
  let layout: WorkspacePaneDurableLayout = { entries: [] }
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
