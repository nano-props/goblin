import { beforeEach, describe, expect, test } from 'vitest'
import {
  beginWorkspacePaneTabCoordinatorTransition,
  observeWorkspacePaneTabCoordinatorRoute,
  resetWorkspacePaneTabCoordinatorForTest,
  runWorkspacePaneTabCoordinatorTask,
  waitForWorkspacePaneTabCoordinatorTransition,
  workspacePaneTabCoordinatorObservedRoute,
  workspacePaneTabCoordinatorPendingIntent,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

const TARGET = {
  repoId: '/repo',
  repoRuntimeId: 'repo-runtime-1',
  branchName: 'feature/a',
  worktreePath: '/worktree-a',
} as const
const SOURCE_ROUTE = { kind: 'static' as const, tab: 'status' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'files' as const }

describe('workspace pane tab coordinator transactions', () => {
  beforeEach(() => {
    resetWorkspacePaneTabCoordinatorForTest()
  })

  test('serializes the same complete resource target', async () => {
    const order: string[] = []
    const release = Promise.withResolvers<void>()
    const first = runWorkspacePaneTabCoordinatorTask(TARGET, async () => {
      order.push('first-start')
      await release.promise
      order.push('first-end')
    })
    const second = runWorkspacePaneTabCoordinatorTask(TARGET, () => {
      order.push('second')
    })

    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    release.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  test.each([
    ['runtime', { ...TARGET, repoRuntimeId: 'repo-runtime-2' }],
    ['worktree', { ...TARGET, worktreePath: '/worktree-b' }],
    ['branch', { ...TARGET, branchName: 'feature/b' }],
  ] as const)('isolates a different %s resource target', async (_resource, otherTarget) => {
    const release = Promise.withResolvers<void>()
    let otherRan = false
    const first = runWorkspacePaneTabCoordinatorTask(TARGET, async () => await release.promise)
    const second = runWorkspacePaneTabCoordinatorTask(otherTarget, () => {
      otherRan = true
    })

    await second
    expect(otherRan).toBe(true)
    release.resolve()
    await first
  })

  test('keeps observed route separate from pending intent and resolves only on exact observation', async () => {
    observeWorkspacePaneTabCoordinatorRoute({ ...TARGET, route: SOURCE_ROUTE })
    const transitionId = beginWorkspacePaneTabCoordinatorTransition({
      ...TARGET,
      fromRoute: SOURCE_ROUTE,
      toRoute: TARGET_ROUTE,
    })
    const completion = waitForWorkspacePaneTabCoordinatorTransition(transitionId)
    let settled = false
    void completion.then(() => {
      settled = true
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    expect(workspacePaneTabCoordinatorObservedRoute(TARGET)).toEqual(SOURCE_ROUTE)
    expect(workspacePaneTabCoordinatorPendingIntent(TARGET)).toEqual({
      fromRoute: SOURCE_ROUTE,
      toRoute: TARGET_ROUTE,
    })

    observeWorkspacePaneTabCoordinatorRoute({ ...TARGET, route: TARGET_ROUTE })
    await expect(completion).resolves.toBe(true)
    expect(workspacePaneTabCoordinatorObservedRoute(TARGET)).toEqual(TARGET_ROUTE)
    expect(workspacePaneTabCoordinatorPendingIntent(TARGET)).toBeNull()
  })

  test('rejects a transition when the observer lands on the wrong route', async () => {
    observeWorkspacePaneTabCoordinatorRoute({ ...TARGET, route: SOURCE_ROUTE })
    const transitionId = beginWorkspacePaneTabCoordinatorTransition({
      ...TARGET,
      fromRoute: SOURCE_ROUTE,
      toRoute: TARGET_ROUTE,
    })
    const completion = waitForWorkspacePaneTabCoordinatorTransition(transitionId)

    observeWorkspacePaneTabCoordinatorRoute({
      ...TARGET,
      route: { kind: 'static', tab: 'history' },
    })

    await expect(completion).resolves.toBe(false)
  })

  test.each([
    { ...TARGET, repoRuntimeId: 'repo-runtime-2' },
    { ...TARGET, branchName: 'feature/b', worktreePath: '/worktree-b' },
  ])('supersedes a pending transaction when another runtime or target is observed', async (replacement) => {
    observeWorkspacePaneTabCoordinatorRoute({ ...TARGET, route: SOURCE_ROUTE })
    const transitionId = beginWorkspacePaneTabCoordinatorTransition({
      ...TARGET,
      fromRoute: SOURCE_ROUTE,
      toRoute: TARGET_ROUTE,
    })
    const completion = waitForWorkspacePaneTabCoordinatorTransition(transitionId)

    observeWorkspacePaneTabCoordinatorRoute({ ...replacement, route: SOURCE_ROUTE })

    await expect(completion).resolves.toBe(false)
  })
})
