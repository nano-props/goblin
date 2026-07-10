// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneTabsCoordinator } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'

const USER_ID = 'user-workspace-pane-tabs'
const REPO_ROOT = '/repo'
const SCOPE = 'repo-runtime-scope'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/repo/worktree'

describe('workspace pane tabs coordinator', () => {
  test('materializes live runtime sessions when listing workspace tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const broadcastChanged = vi.fn()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    await expect(
      coordinator.listWorkspaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        assertCurrent: () => {},
        broadcastChanged,
      }),
    ).resolves.toEqual(
      snapshot(1, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
    expect(broadcastChanged).toHaveBeenCalledOnce()
  })

  test('prunes stale runtime tabs when replacing workspace tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    await expect(
      coordinator.replaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        ],
        assertCurrent: () => {},
      }),
    ).resolves.toEqual(
      snapshot(1, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
  })

  test('materializes missing live runtime sessions when replacing workspace tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    await expect(
      coordinator.replaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('status')],
        assertCurrent: () => {},
      }),
    ).resolves.toEqual(
      snapshot(1, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
    expect(
      workspaceTabs.tabs({ userId: USER_ID, scope: SCOPE, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH }),
    ).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
    ])
  })

  test('materializes missing live runtime sessions when updating workspace tabs', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    await expect(
      coordinator.updateTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
        assertCurrent: () => {},
      }),
    ).resolves.toEqual(
      snapshot(2, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
  })

  test('does not mutate workspace tabs when update canonicalization fails', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      userId: USER_ID,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => {
            throw new Error('provider failed')
          }),
        },
      ],
    })

    await expect(
      coordinator.updateTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('provider failed')
    expect(workspaceTabs.tabs(workspaceTarget())).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not mutate workspace tabs when update becomes stale before commit', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })
    let assertCalls = 0

    await expect(
      coordinator.updateTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
        assertCurrent: () => {
          assertCalls += 1
          if (assertCalls === 2) throw new Error('error.repo-runtime-stale')
        },
      }),
    ).rejects.toThrow('error.repo-runtime-stale')
    expect(workspaceTabs.tabs(workspaceTarget())).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('does not partially materialize runtime tabs when reconcile provider loading fails', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => {
            throw new Error('provider failed')
          }),
        },
      ],
    })

    await expect(
      coordinator.reconcileWorktree({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        worktreePath: WORKTREE_PATH,
      }),
    ).rejects.toThrow('provider failed')
    expect(workspaceTabs.tabs(workspaceTarget())).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('serializes list canonicalization with scope updates', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      ...workspaceTarget(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
      ],
    })
    const liveSessions = deferred<Array<{ sessionId: string; branch: string; worktreePath: string }>>()
    const listSessionsForUser = vi.fn(async () => await liveSessions.promise)
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser,
        },
      ],
    })

    const list = coordinator.listWorkspaceTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      assertCurrent: () => {},
      broadcastChanged: vi.fn(),
    })
    await vi.waitFor(() => expect(listSessionsForUser).toHaveBeenCalledTimes(1))
    expect(workspaceTabs.tabs(workspaceTarget())).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
    ])
    const update = coordinator.updateTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      operation: { type: 'open-static', tabType: 'history' },
      assertCurrent: () => {},
    })

    liveSessions.resolve([
      { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
    ])

    await expect(list).resolves.toEqual(
      snapshot(2, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
    await expect(update).resolves.toEqual(
      snapshot(3, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        workspacePaneStaticTabEntry('history'),
      ]),
    )
    expect(workspaceTabs.tabs(workspaceTarget())).toEqual([
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      workspacePaneStaticTabEntry('history'),
    ])
  })

  test('serializes scope close after pending reconciliation', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    workspaceTabs.replaceTabs({
      ...workspaceTarget(),
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-stalestalestalestale1'),
      ],
    })
    const liveSessions = deferred<Array<{ sessionId: string; branch: string; worktreePath: string }>>()
    const listSessionsForUser = vi.fn(async () => await liveSessions.promise)
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      runtimeProviders: [{ type: 'terminal', listSessionsForUser }],
    })

    const reconcile = coordinator.reconcileWorktree({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      worktreePath: WORKTREE_PATH,
    })
    await vi.waitFor(() => expect(listSessionsForUser).toHaveBeenCalledTimes(1))
    const close = coordinator.closeScope({ userId: USER_ID, scope: SCOPE })

    liveSessions.resolve([
      { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
    ])
    await Promise.all([reconcile, close])

    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([])
  })

  test('rejects canonical tab writes while worktree removal is admitted', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const finishRemoval = deferred<void>()
    const removal = worktreeOperations.runRemoval(
      { repoRoot: REPO_ROOT, worktreePath: WORKTREE_PATH },
      async () => await finishRemoval.promise,
    )
    const coordinator = createWorkspacePaneTabsCoordinator({ workspaceTabs, worktreeOperations, runtimeProviders: [] })

    await expect(
      coordinator.updateTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('error.worktree-removal-in-progress')

    await expect(
      coordinator.updateTabs({
        userId: 'other-user',
        repoRoot: REPO_ROOT,
        scope: `${REPO_ROOT}\0repo-runtime-other`,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        operation: { type: 'open-static', tabType: 'history' },
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('error.worktree-removal-in-progress')

    finishRemoval.resolve(undefined)
    await removal
  })
})

function workspaceTarget() {
  return {
    userId: USER_ID,
    scope: SCOPE,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  }
}

function snapshot(revision: number, tabs: WorkspacePaneTabEntry[]) {
  return {
    revision,
    entries: [{ repoRoot: REPO_ROOT, branchName: BRANCH_NAME, worktreePath: WORKTREE_PATH, tabs }],
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
