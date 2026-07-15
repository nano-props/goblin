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
  testWorkspacePaneTarget as workspaceTarget,
} from '#/server/test-utils/workspace-pane-tabs-coordinator.ts'
import {
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

describe('workspace pane tabs coordinator persistence', () => {
  test('persists durable layout before committing an explicit replacement', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const persistLayout = vi.fn(async () => {
      throw new Error('disk unavailable')
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
      persistLayout,
    })

    await expect(
      coordinator.replaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        branchName: 'main',
        worktreePath: null,
        tabs: [workspacePaneStaticTabEntry('history')],
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('disk unavailable')

    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([])
    expect(workspaceTabs.revision({ userId: USER_ID, scope: SCOPE })).toBe(0)
  })

  test('persists only restart-durable static layout entries', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const persistLayout = vi.fn(async () => {})
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
      persistLayout,
    })

    await coordinator.replaceTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [
        workspacePaneStaticTabEntry('changes'),
        workspacePaneRuntimeTabEntry('terminal', 'term-liveduringrequest1'),
      ],
      assertCurrent: () => {},
    })

    expect(persistLayout).toHaveBeenCalledWith(REPO_ROOT, {
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
          tabs: [workspacePaneStaticTabEntry('changes')],
        },
      ],
    })
  })

  test('retires one branch target without removing other durable layout', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: 'feature/retired',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('changes')],
    })
    const persistLayout = vi.fn(async () => {})
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
      persistLayout,
    })

    await coordinator.retireTarget({
      userId: USER_ID,
      scope: SCOPE,
      target: { kind: 'branch', repoRoot: REPO_ROOT, branchName: 'feature/retired' },
      assertCurrent: () => {},
    })

    expect(persistLayout).toHaveBeenCalledWith(REPO_ROOT, {
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
          tabs: [workspacePaneStaticTabEntry('changes')],
        },
      ],
    })
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([
      {
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('changes')],
      },
    ])
  })

  test('does not retire a live target when durable cleanup fails', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: 'feature/retired',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
      persistLayout: async () => {
        throw new Error('disk unavailable')
      },
    })

    await expect(
      coordinator.retireTarget({
        userId: USER_ID,
        scope: SCOPE,
        target: { kind: 'branch', repoRoot: REPO_ROOT, branchName: 'feature/retired' },
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('disk unavailable')
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toHaveLength(1)
  })

  test('retires one removed worktree without removing other durable layout', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: 'main',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
    })
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('changes')],
    })
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const persistLayout = vi.fn(async () => {})
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
      persistLayout,
    })
    await coordinator.retireTarget({
      userId: USER_ID,
      scope: SCOPE,
      target: { kind: 'worktree', repoRoot: REPO_ROOT, worktreePath: WORKTREE_PATH },
    })

    expect(persistLayout).toHaveBeenCalledWith(REPO_ROOT, {
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'main',
          worktreePath: null,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ],
    })
    expect(workspaceTabs.tabsForScope({ userId: USER_ID, scope: SCOPE })).toEqual([
      {
        branchName: 'main',
        worktreePath: null,
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
  })
})
