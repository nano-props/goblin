import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
  tryRunWorkspacePaneAction,
  workspacePaneActionQueueStatsForTest,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')
const OTHER_WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-1'
const LINKED_LOCATION = linkedLocation('/worktree-a', WORKSPACE_RUNTIME_ID)

describe('workspace pane action queue', () => {
  beforeEach(() => resetWorkspacePaneActionQueueForTest())

  test('serializes the same admitted location and releases its owner on idle', async () => {
    const actionOrder: string[] = []
    const release = Promise.withResolvers<void>()
    const firstStarted = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(LINKED_LOCATION, async () => {
      actionOrder.push('first-start')
      firstStarted.resolve()
      await release.promise
      actionOrder.push('first-end')
    })
    const second = runWorkspacePaneAction(LINKED_LOCATION, () => actionOrder.push('second'))

    await firstStarted.promise
    expect(actionOrder).toEqual(['first-start'])
    release.resolve()
    await Promise.all([first, second])
    expect(actionOrder).toEqual(['first-start', 'first-end', 'second'])
    await vi.waitFor(() => expect(workspacePaneActionQueueStatsForTest().paneOwnerQueues).toBe(0))
  })

  test('admits an idle presentation action and rejects one while the location is owned', async () => {
    await expect(tryRunWorkspacePaneAction(LINKED_LOCATION, () => 'idle')).resolves.toEqual({
      kind: 'accepted',
      result: 'idle',
    })

    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const occupied = runWorkspacePaneAction(LINKED_LOCATION, async () => {
      started.resolve()
      await release.promise
    })
    await started.promise

    await expect(tryRunWorkspacePaneAction(LINKED_LOCATION, () => 'should-not-run')).resolves.toEqual({
      kind: 'busy',
    })
    release.resolve()
    await occupied
  })

  test('serializes workspace-root actions without inventing a branch', async () => {
    const location = rootLocation(OTHER_WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const actionOrder: string[] = []
    const release = Promise.withResolvers<void>()
    const firstStarted = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(location, async () => {
      actionOrder.push('first')
      firstStarted.resolve()
      await release.promise
    })
    const second = runWorkspacePaneAction(location, () => actionOrder.push('second'))

    await firstStarted.promise
    expect(actionOrder).toEqual(['first'])
    release.resolve()
    await Promise.all([first, second])
    expect(actionOrder).toEqual(['first', 'second'])
  })

  test('coordinates a source worktree through its workspace-root pane owner', async () => {
    const sourceLocation: WorkspacePaneLocation = {
      kind: 'source-worktree',
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/physical/repo' },
      paneTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
      worktreeHead: { kind: 'branch', branchName: 'main' },
      branchName: 'main',
    }
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const occupied = runWorkspacePaneAction(sourceLocation, async () => {
      started.resolve()
      await release.promise
    })
    await started.promise

    await expect(
      tryRunWorkspacePaneAction(rootLocation(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), () => 'should-not-run'),
    ).resolves.toEqual({ kind: 'busy' })
    release.resolve()
    await occupied
  })

  test.each([
    ['runtime', LINKED_LOCATION, linkedLocation('/worktree-a', 'repo-runtime-2')],
    ['worktree', LINKED_LOCATION, linkedLocation('/worktree-b', WORKSPACE_RUNTIME_ID)],
    ['branch', branchLocation('feature/a'), branchLocation('feature/b')],
    ['workspace', LINKED_LOCATION, linkedLocation('/worktree-a', WORKSPACE_RUNTIME_ID, OTHER_WORKSPACE_ID)],
  ] as const)(
    'allows a different %s location to progress independently',
    async (_resource, occupiedLocation, otherLocation) => {
      const release = Promise.withResolvers<void>()
      const first = runWorkspacePaneAction(occupiedLocation, () => release.promise)
      let otherRan = false

      await runWorkspacePaneAction(otherLocation, () => {
        otherRan = true
      })
      expect(otherRan).toBe(true)
      release.resolve()
      await first
    },
  )
})

function linkedLocation(
  worktreePath: string,
  workspaceRuntimeId: string,
  workspaceId: typeof WORKSPACE_ID = WORKSPACE_ID,
): WorkspacePaneLocation {
  return {
    kind: 'linked-worktree',
    workspaceId,
    workspaceRuntimeId,
    routeTarget: { kind: 'git-worktree', workspaceId, worktreePath },
    paneTarget: { kind: 'git-worktree', workspaceId, worktreePath },
    worktreeHead: { kind: 'detached' },
    branchName: null,
  }
}

function branchLocation(branchName: string): WorkspacePaneLocation {
  return {
    kind: 'branch',
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName },
    paneTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName },
    worktreeHead: null,
    branchName,
  }
}

function rootLocation(workspaceId: typeof WORKSPACE_ID, workspaceRuntimeId: string): WorkspacePaneLocation {
  return {
    kind: 'workspace-root',
    workspaceId,
    workspaceRuntimeId,
    routeTarget: { kind: 'workspace-root', workspaceId },
    paneTarget: { kind: 'workspace-root', workspaceId },
    worktreeHead: null,
    branchName: null,
  }
}
