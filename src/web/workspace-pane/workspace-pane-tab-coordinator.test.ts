import { beforeEach, describe, expect, test } from 'vitest'
import {
  abortWorkspacePaneTabCoordinatorTransition,
  beginWorkspacePaneTabCoordinatorTransition,
  completeWorkspacePaneTabCoordinatorTransition,
  observeWorkspacePaneTabCoordinatorRoute,
  resetWorkspacePaneTabCoordinatorForTest,
  runWorkspacePaneTabCoordinatorTask,
  workspacePaneTabCoordinatorReconciliationDeferred,
} from '#/web/workspace-pane/workspace-pane-tab-coordinator.ts'

describe('workspace pane tab coordinator', () => {
  beforeEach(() => {
    resetWorkspacePaneTabCoordinatorForTest()
  })

  test('serializes actions for the same workspace pane target', async () => {
    const order: string[] = []
    let releaseFirst = () => {}
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = runWorkspacePaneTabCoordinatorTask(
      { repoId: '/tmp/repo', branchName: 'feature/a', worktreePath: '/tmp/worktree-a' },
      async () => {
        order.push('first-start')
        await firstRelease
        order.push('first-end')
      },
    )
    const second = runWorkspacePaneTabCoordinatorTask(
      { repoId: '/tmp/repo', branchName: 'feature/a', worktreePath: '/tmp/worktree-a' },
      () => {
        order.push('second')
      },
    )

    await Promise.resolve()
    expect(order).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  test('does not serialize actions for different workspace pane targets', async () => {
    const order: string[] = []
    let releaseFirst = () => {}
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = runWorkspacePaneTabCoordinatorTask(
      { repoId: '/tmp/repo', branchName: 'feature/a', worktreePath: '/tmp/worktree-a' },
      async () => {
        order.push('first-start')
        await firstRelease
        order.push('first-end')
      },
    )
    const second = runWorkspacePaneTabCoordinatorTask(
      { repoId: '/tmp/repo', branchName: 'feature/b', worktreePath: '/tmp/worktree-b' },
      () => {
        order.push('second')
      },
    )

    await second
    expect(order).toEqual(['first-start', 'second'])
    releaseFirst()
    await first
    expect(order).toEqual(['first-start', 'second', 'first-end'])
  })

  test('defers stale route reconciliation until the route leaves the transition source', () => {
    beginWorkspacePaneTabCoordinatorTransition({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })

    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(true)

    observeWorkspacePaneTabCoordinatorRoute({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      route: { kind: 'static', tab: 'status' },
    })

    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(false)
  })

  test('clears stale route reconciliation deferral when a transition aborts', () => {
    const transitionId = beginWorkspacePaneTabCoordinatorTransition({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })

    abortWorkspacePaneTabCoordinatorTransition(transitionId)

    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(false)
  })

  test('clears stale route reconciliation deferral when committed navigation settles', () => {
    const transitionId = beginWorkspacePaneTabCoordinatorTransition({
      repoId: '/tmp/repo',
      repoRuntimeId: 'repo-runtime-1',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })

    completeWorkspacePaneTabCoordinatorTransition(transitionId)

    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        repoRuntimeId: 'repo-runtime-1',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(false)
  })

  test('does not let a transition from an old repo runtime defer the replacement runtime', () => {
    beginWorkspacePaneTabCoordinatorTransition({
      repoId: '/tmp/repo',
      repoRuntimeId: 'repo-runtime-old',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })

    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        repoRuntimeId: 'repo-runtime-new',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(false)
  })

  test('keeps only the latest pending transition for a workspace pane target', () => {
    beginWorkspacePaneTabCoordinatorTransition({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      fromRoute: { kind: 'static', tab: 'files' },
      toRoute: { kind: 'static', tab: 'status' },
    })
    beginWorkspacePaneTabCoordinatorTransition({
      repoId: '/tmp/repo',
      branchName: 'feature/a',
      worktreePath: '/tmp/worktree-a',
      fromRoute: { kind: 'static', tab: 'history' },
      toRoute: { kind: 'static', tab: 'changes' },
    })

    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'files' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(false)
    expect(
      workspacePaneTabCoordinatorReconciliationDeferred({
        repoId: '/tmp/repo',
        branchName: 'feature/a',
        worktreePath: '/tmp/worktree-a',
        route: { kind: 'static', tab: 'history' },
        reconciliation: { kind: 'replace-empty-pane' },
      }),
    ).toBe(true)
  })
})
