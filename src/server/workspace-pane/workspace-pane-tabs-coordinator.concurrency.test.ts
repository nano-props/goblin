// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  replaceTestWorkspaceTabs,
  testPhysicalWorktreeCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import {
  TEST_WORKSPACE_PANE_BRANCH_NAME as BRANCH_NAME,
  TEST_WORKSPACE_PANE_REPO_ROOT as REPO_ROOT,
  TEST_WORKSPACE_PANE_SCOPE as SCOPE,
  TEST_WORKSPACE_PANE_USER_ID as USER_ID,
  TEST_WORKSPACE_PANE_WORKTREE_PATH as WORKTREE_PATH,
  createTestWorkspacePaneTabsCoordinator as createWorkspacePaneTabsCoordinator,
  deferredTestValue as deferred,
  testWorkspacePaneSnapshot as snapshot,
  testWorkspacePaneTarget as workspaceTarget,
} from '#/server/test-utils/workspace-pane-tabs-coordinator.ts'
import {
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

describe('workspace pane tabs coordinator concurrency', () => {
  test('does not mutate workspace tabs when update canonicalization fails', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
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
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
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
      physicalWorktrees: testPhysicalWorktrees,
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
    replaceTestWorkspaceTabs(workspaceTabs, {
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
      physicalWorktrees: testPhysicalWorktrees,
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
        workspacePaneStaticTabEntry('history'),
      ]),
    )
    await expect(update).resolves.toEqual(
      snapshot(2, [
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
    replaceTestWorkspaceTabs(workspaceTabs, {
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
      physicalWorktrees: testPhysicalWorktrees,
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
      testPhysicalWorktreeCapability(WORKTREE_PATH),
      async () => await finishRemoval.promise,
    )
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
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

  test('does not rematerialize a provider session while physical removal is admitted', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const finishRemoval = deferred<void>()
    const removal = worktreeOperations.runRemoval(
      testPhysicalWorktreeCapability(WORKTREE_PATH),
      async () => await finishRemoval.promise,
    )
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
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
      }),
    ).rejects.toThrow('error.worktree-removal-in-progress')
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([])

    finishRemoval.resolve(undefined)
    await removal
  })

  test('lets a canonical tab write admitted before removal finish in physical queue order', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const physicalCapability = testPhysicalWorktreeCapability(WORKTREE_PATH)
    const capturePhysicalWorktree = vi.fn(async () => physicalCapability)
    const liveSessions = deferred<[]>()
    const listSessionsForUser = vi.fn(async () => await liveSessions.promise)
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations,
      physicalWorktrees: { capture: capturePhysicalWorktree },
      runtimeProviders: [{ type: 'terminal', listSessionsForUser }],
    })

    const update = coordinator.updateTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      operation: { type: 'open-static', tabType: 'history' },
      assertCurrent: () => {},
    })
    await vi.waitFor(() => expect(listSessionsForUser).toHaveBeenCalledOnce())

    const removal = worktreeOperations.runRemoval(physicalCapability, async () => 'removed')
    expect(worktreeOperations.isRemovalAdmitted(testPhysicalWorktreeIdentity(WORKTREE_PATH))).toBe(true)

    liveSessions.resolve([])
    await expect(update).resolves.toMatchObject({ revision: 1 })
    expect(capturePhysicalWorktree).toHaveBeenCalledOnce()
    await expect(removal).resolves.toEqual({ admitted: true, value: 'removed' })
  })
})
