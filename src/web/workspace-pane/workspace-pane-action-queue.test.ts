import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneRouteIntent,
  finishWorkspacePaneRouteIntent,
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
  workspacePaneActionTargetKey,
  workspacePaneActionTargetFromFilesystemTarget,
  workspacePaneActionTargetFromCoordinates,
  workspacePaneActionQueueStatsForTest,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

const TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: 'goblin+file:///repo',
  workspaceRuntimeId: 'repo-runtime-1',
  worktreePath: '/worktree-a',
} as const

describe('workspace pane action queue', () => {
  beforeEach(() => resetWorkspacePaneActionQueueForTest())

  test('serializes the same complete resource target and cleans up on idle', async () => {
    const workspaceOrder: string[] = []
    const release = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(TARGET, async () => {
      workspaceOrder.push('first-start')
      await release.promise
      workspaceOrder.push('first-end')
    })
    const second = runWorkspacePaneAction(TARGET, () => workspaceOrder.push('second'))

    await Promise.resolve()
    expect(workspaceOrder).toEqual(['first-start'])
    release.resolve()
    await Promise.all([first, second])
    expect(workspaceOrder).toEqual(['first-start', 'first-end', 'second'])
    await vi.waitFor(() => expect(workspacePaneActionQueueStatsForTest().targetQueues).toBe(0))
  })

  test('serializes workspace-scoped actions without inventing a branch', async () => {
    const workspaceTarget = {
      kind: 'workspace-root' as const,
      workspaceId: 'goblin+file:///workspace',
      workspaceRuntimeId: 'repo-runtime-1',
    }
    const workspaceOrder: string[] = []
    const release = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(workspaceTarget, async () => {
      workspaceOrder.push('first')
      await release.promise
    })
    const second = runWorkspacePaneAction(workspaceTarget, () => workspaceOrder.push('second'))

    await Promise.resolve()
    expect(workspaceOrder).toEqual(['first'])
    release.resolve()
    await Promise.all([first, second])
    expect(workspaceOrder).toEqual(['first', 'second'])
  })

  test('identifies a detached worktree by its filesystem path instead of workspace-root scope', () => {
    expect(
      workspacePaneActionTargetFromCoordinates({
        workspaceId: TARGET.workspaceId,
        workspaceRuntimeId: TARGET.workspaceRuntimeId,
        branchName: null,
        worktreePath: TARGET.worktreePath,
      }),
    ).toEqual(TARGET)
  })

  test.each([
    ['runtime', { ...TARGET, workspaceRuntimeId: 'repo-runtime-2' }],
    ['worktree', { ...TARGET, worktreePath: '/worktree-b' }],
    [
      'branch',
      {
        kind: 'git-branch' as const,
        workspaceId: TARGET.workspaceId,
        workspaceRuntimeId: TARGET.workspaceRuntimeId,
        branchName: 'feature/b',
      },
    ],
  ] as const)('allows a different %s target to progress independently', async (_resource, otherTarget) => {
    const release = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(TARGET, async () => await release.promise)
    let otherRan = false

    await runWorkspacePaneAction(otherTarget, () => {
      otherRan = true
    })
    expect(otherRan).toBe(true)
    release.resolve()
    await first
  })

  test('keys every target kind from only its authoritative identity', () => {
    expect(
      workspacePaneActionTargetKey({
        kind: 'workspace-root',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'runtime',
      }),
    ).toBe('goblin+file:///repo\0runtime\0workspace-root')
    expect(
      workspacePaneActionTargetKey({
        kind: 'git-branch',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'runtime',
        branchName: 'main',
      }),
    ).toBe('goblin+file:///repo\0runtime\0git-branch\0main')
    expect(
      workspacePaneActionTargetKey({
        kind: 'git-worktree' as const,
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'runtime',
        worktreePath: '/repo-worktree',
      }),
    ).toBe('goblin+file:///repo\0runtime\0git-worktree\0/repo-worktree')
  })

  test('keeps a detached Git worktree in its worktree queue', () => {
    const workspaceId = canonicalWorkspaceLocator('goblin+file:///repo')
    const root = canonicalWorkspaceLocator('goblin+file:///repo-detached')
    if (!workspaceId || !root) throw new Error('invalid mock filesystem target')

    expect(
      workspacePaneActionTargetFromFilesystemTarget({
        kind: 'git-worktree',
        workspaceId,
        workspaceRuntimeId: 'runtime',
        root,
      }),
    ).toEqual({
      kind: 'git-worktree',
      workspaceId: workspaceId,
      workspaceRuntimeId: 'runtime',
      worktreePath: '/repo-detached',
    })
    expect(
      workspacePaneActionTargetFromCoordinates({
        workspaceId: workspaceId,
        workspaceRuntimeId: 'runtime',
        branchName: null,
        worktreePath: '/repo-detached',
      }),
    ).toMatchObject({ kind: 'git-worktree', worktreePath: '/repo-detached' })
  })

  test('bounds a pending route intent to its target and explicit lifetime', () => {
    const intentId = beginWorkspacePaneRouteIntent(TARGET, 'static:files')

    expect(workspacePaneRouteIntentPending(TARGET, 'static:files')).toBe(true)
    expect(workspacePaneRouteIntentPending({ ...TARGET, workspaceRuntimeId: 'repo-runtime-2' }, 'static:files')).toBe(
      false,
    )
    expect(workspacePaneActionQueueStatsForTest().pendingRouteIntents).toBe(1)

    finishWorkspacePaneRouteIntent(intentId)
    expect(workspacePaneRouteIntentPending(TARGET, 'static:files')).toBe(false)
    expect(workspacePaneActionQueueStatsForTest().pendingRouteIntents).toBe(0)
  })
})
