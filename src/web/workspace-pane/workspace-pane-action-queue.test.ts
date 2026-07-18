import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneRouteIntent,
  finishWorkspacePaneRouteIntent,
  resetWorkspacePaneActionQueueForTest,
  runWorkspacePaneAction,
  workspacePaneActionTargetKey,
  workspacePaneActionQueueStatsForTest,
  workspacePaneRouteIntentPending,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'

const TARGET = {
  kind: 'git-worktree',
  repoId: 'goblin+file:///repo',
  repoRuntimeId: 'repo-runtime-1',
  worktreePath: '/worktree-a',
} as const

describe('workspace pane action queue', () => {
  beforeEach(() => resetWorkspacePaneActionQueueForTest())

  test('serializes the same complete resource target and cleans up on idle', async () => {
    const order: string[] = []
    const release = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(TARGET, async () => {
      order.push('first-start')
      await release.promise
      order.push('first-end')
    })
    const second = runWorkspacePaneAction(TARGET, () => order.push('second'))

    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    release.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
    await vi.waitFor(() => expect(workspacePaneActionQueueStatsForTest().targetQueues).toBe(0))
  })

  test('serializes workspace-scoped actions without inventing a branch', async () => {
    const workspaceTarget = {
      kind: 'workspace-root' as const,
      repoId: 'goblin+file:///workspace',
      repoRuntimeId: 'repo-runtime-1',
    }
    const order: string[] = []
    const release = Promise.withResolvers<void>()
    const first = runWorkspacePaneAction(workspaceTarget, async () => {
      order.push('first')
      await release.promise
    })
    const second = runWorkspacePaneAction(workspaceTarget, () => order.push('second'))

    await Promise.resolve()
    expect(order).toEqual(['first'])
    release.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  test.each([
    ['runtime', { ...TARGET, repoRuntimeId: 'repo-runtime-2' }],
    ['worktree', { ...TARGET, worktreePath: '/worktree-b' }],
    [
      'branch',
      {
        kind: 'git-branch' as const,
        repoId: TARGET.repoId,
        repoRuntimeId: TARGET.repoRuntimeId,
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
        repoId: 'goblin+file:///repo',
        repoRuntimeId: 'runtime',
      }),
    ).toBe('goblin+file:///repo\0runtime\0workspace-root')
    expect(
      workspacePaneActionTargetKey({
        kind: 'git-branch',
        repoId: 'goblin+file:///repo',
        repoRuntimeId: 'runtime',
        branchName: 'main',
      }),
    ).toBe('goblin+file:///repo\0runtime\0git-branch\0main')
    expect(
      workspacePaneActionTargetKey({
        kind: 'git-worktree',
        repoId: 'goblin+file:///repo',
        repoRuntimeId: 'runtime',
        worktreePath: '/repo-worktree',
      }),
    ).toBe('goblin+file:///repo\0runtime\0git-worktree\0/repo-worktree')
  })

  test('bounds a pending route intent to its target and explicit lifetime', () => {
    const intentId = beginWorkspacePaneRouteIntent(TARGET, 'static:files')

    expect(workspacePaneRouteIntentPending(TARGET, 'static:files')).toBe(true)
    expect(workspacePaneRouteIntentPending({ ...TARGET, repoRuntimeId: 'repo-runtime-2' }, 'static:files')).toBe(false)
    expect(workspacePaneActionQueueStatsForTest().pendingRouteIntents).toBe(1)

    finishWorkspacePaneRouteIntent(intentId)
    expect(workspacePaneRouteIntentPending(TARGET, 'static:files')).toBe(false)
    expect(workspacePaneActionQueueStatsForTest().pendingRouteIntents).toBe(0)
  })
})
