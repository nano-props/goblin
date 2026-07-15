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
  testWorkspacePaneSnapshot as snapshot,
  testWorkspacePaneTarget as workspaceTarget,
} from '#/server/test-utils/workspace-pane-tabs-coordinator.ts'
import {
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

describe('workspace pane tabs coordinator projection', () => {
  test('does not let restore initialization overwrite an initialized scope', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
    })

    await coordinator.replaceTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      branchName: 'main',
      worktreePath: null,
      tabs: [workspacePaneStaticTabEntry('history')],
      assertCurrent: () => {},
    })

    await expect(
      coordinator.initializeScope({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        entries: [{ branchName: 'main', worktreePath: null, tabs: [workspacePaneStaticTabEntry('changes')] }],
        assertCurrent: () => {},
      }),
    ).resolves.toEqual({
      revision: 1,
      entries: [
        {
          repoRoot: REPO_ROOT,
          branchName: 'main',
          worktreePath: null,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ],
    })
  })

  test('records an empty scope as initialized', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [],
    })

    await expect(
      coordinator.initializeScope({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        entries: [],
        assertCurrent: () => {},
      }),
    ).resolves.toEqual({ revision: 0, entries: [] })
    expect(workspaceTabs.isScopeInitialized({ userId: USER_ID, scope: SCOPE })).toBe(true)
  })

  test('materializes live runtime sessions when listing workspace tabs', async () => {
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
      ],
    })

    await expect(
      coordinator.listWorkspaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        assertCurrent: () => {},
      }),
    ).resolves.toEqual(
      snapshot(0, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
  })

  test('prunes stale runtime tabs when replacing workspace tabs', async () => {
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
    ).toEqual([workspacePaneStaticTabEntry('status')])
  })

  test('materializes missing live runtime sessions when updating workspace tabs', async () => {
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
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
        workspacePaneStaticTabEntry('history'),
      ]),
    )
  })

  test('lets a projected-only runtime tab participate in reorder and insertion', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
    })
    const terminal = workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1')
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
    const ordered = [workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('history')]
    await expect(
      coordinator.updateTabs({
        ...workspaceTarget(),
        repoRoot: REPO_ROOT,
        operation: { type: 'reorder', tabIdentities: ordered.map(workspacePaneTabEntryIdentity) },
        assertCurrent: () => {},
      }),
    ).resolves.toEqual(snapshot(2, ordered))
    await expect(
      coordinator.updateTabs({
        ...workspaceTarget(),
        repoRoot: REPO_ROOT,
        operation: {
          type: 'open-static',
          tabType: 'files',
          insertAfterIdentity: workspacePaneTabEntryIdentity(terminal),
        },
        assertCurrent: () => {},
      }),
    ).resolves.toEqual(
      snapshot(3, [
        workspacePaneStaticTabEntry('status'),
        terminal,
        workspacePaneStaticTabEntry('files'),
        workspacePaneStaticTabEntry('history'),
      ]),
    )
  })

  test('inserts a new runtime tab after a projected-only opener', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
    })
    const opener = workspacePaneRuntimeTabEntry('terminal', 'term-openeropeneropenerope1')
    const created = workspacePaneRuntimeTabEntry('terminal', 'term-createdcreatedcreatedcr1')
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeCapability(WORKTREE_PATH, {
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      repoRuntimeId: SCOPE,
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-openeropeneropenerope1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
            { sessionId: 'term-createdcreatedcreatedcr1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
          ]),
        },
      ],
    })

    const result = await worktreeOperations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          ...workspaceTarget(),
          repoRoot: REPO_ROOT,
          runtimeType: 'terminal',
          sessionId: 'term-createdcreatedcreatedcr1',
          insertAfterIdentity: workspacePaneTabEntryIdentity(opener),
          permit,
          physicalWorktreeCapability: capability,
        }),
    )

    expect(result).toEqual({
      admitted: true,
      value: snapshot(2, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('history'),
        opener,
        created,
      ]),
    })
  })

  test('returns a scope-wide canonical snapshot after a target mutation', async () => {
    const otherBranch = 'feature/other'
    const otherWorktree = '/repo/other-worktree'
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: otherBranch,
      worktreePath: otherWorktree,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const worktreeOperations = createPhysicalWorktreeOperationCoordinator()
    const capability = testPhysicalWorktreeCapability(WORKTREE_PATH, {
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      repoRuntimeId: SCOPE,
    })
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations,
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [
        {
          type: 'terminal',
          listSessionsForUser: vi.fn(async () => [
            { sessionId: 'term-createdcreatedcreatedcr1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
            { sessionId: 'term-otherotherotherotherot1', branch: otherBranch, worktreePath: otherWorktree },
          ]),
        },
      ],
    })

    const result = await worktreeOperations.runOperation(
      capability,
      async (permit) =>
        await coordinator.ensureRuntimeTabForSession({
          ...workspaceTarget(),
          repoRoot: REPO_ROOT,
          runtimeType: 'terminal',
          sessionId: 'term-createdcreatedcreatedcr1',
          permit,
          physicalWorktreeCapability: capability,
        }),
    )

    expect(result).toEqual({
      admitted: true,
      value: {
        revision: 3,
        entries: [
          {
            repoRoot: REPO_ROOT,
            branchName: BRANCH_NAME,
            worktreePath: WORKTREE_PATH,
            tabs: [
              workspacePaneStaticTabEntry('status'),
              workspacePaneRuntimeTabEntry('terminal', 'term-createdcreatedcreatedcr1'),
            ],
          },
          {
            repoRoot: REPO_ROOT,
            branchName: otherBranch,
            worktreePath: otherWorktree,
            tabs: [
              workspacePaneStaticTabEntry('status'),
              workspacePaneRuntimeTabEntry('terminal', 'term-otherotherotherotherot1'),
            ],
          },
        ],
      },
    })
  })

  test('advances canonical revision when provider membership changes without a layout write', async () => {
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    let providerRevision = 1
    let liveSessions = [{ sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH }]
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [
        {
          type: 'terminal',
          captureSnapshotForUser: vi.fn(async () => ({ revision: providerRevision, liveSessions })),
        },
      ],
    })

    const withTerminal = await coordinator.listWorkspaceTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      assertCurrent: () => {},
    })
    providerRevision = 2
    liveSessions = []
    const afterClose = await coordinator.listWorkspaceTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      assertCurrent: () => {},
    })

    expect(withTerminal).toEqual(
      snapshot(1, [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
      ]),
    )
    expect(afterClose).toEqual(snapshot(2, [workspacePaneStaticTabEntry('status')]))

    providerRevision = 1
    liveSessions = [{ sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH }]
    await expect(
      coordinator.listWorkspaceTabs({
        userId: USER_ID,
        repoRoot: REPO_ROOT,
        scope: SCOPE,
        assertCurrent: () => {},
      }),
    ).rejects.toThrow('error.workspace-tabs-provider-snapshot-stale')
  })

  test('reconciling one worktree returns provider membership for the full scope', async () => {
    const otherBranch = 'feature/reconcile-other'
    const otherWorktree = '/repo/reconcile-other'
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(),
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    replaceTestWorkspaceTabs(workspaceTabs, {
      userId: USER_ID,
      scope: SCOPE,
      branchName: otherBranch,
      worktreePath: otherWorktree,
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
            { sessionId: 'term-currentcurrentcurrentcu1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
            { sessionId: 'term-otherotherotherotherot1', branch: otherBranch, worktreePath: otherWorktree },
          ]),
        },
      ],
    })

    const result = await coordinator.reconcileWorktree({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      worktreePath: WORKTREE_PATH,
    })

    expect(result.entries).toEqual([
      {
        repoRoot: REPO_ROOT,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-currentcurrentcurrentcu1'),
        ],
      },
      {
        repoRoot: REPO_ROOT,
        branchName: otherBranch,
        worktreePath: otherWorktree,
        tabs: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-otherotherotherotherot1'),
        ],
      },
    ])
  })
})
