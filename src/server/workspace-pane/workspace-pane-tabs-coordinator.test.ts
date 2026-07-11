// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import {
  createWorkspacePaneTabsCoordinator as createProductionWorkspacePaneTabsCoordinator,
  type WorkspacePaneRuntimeTabsLiveSession,
} from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { createWorkspacePaneTabsRuntime } from '#/server/workspace-pane/workspace-pane-tabs-runtime.ts'
import { createPhysicalWorktreeOperationCoordinator } from '#/server/worktree-removal/physical-worktree-operation-coordinator.ts'
import {
  replaceTestWorkspaceTabs,
  testPhysicalWorktreeCapability,
  testPhysicalWorktreeIdentity,
  testPhysicalWorktrees,
} from '#/server/test-utils/physical-worktree-identity.ts'
import {
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'

const USER_ID = 'user-workspace-pane-tabs'
const REPO_ROOT = '/repo'
const SCOPE = 'repo-runtime-scope'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/repo/worktree'

type ProductionCoordinatorOptions = Parameters<typeof createProductionWorkspacePaneTabsCoordinator>[0]
type TestRuntimeProvider = ProductionCoordinatorOptions['runtimeProviders'][number] | {
  type: 'terminal'
  listSessionsForUser(userId: string, scope: string): Promise<WorkspacePaneRuntimeTabsLiveSession[]>
}

function createWorkspacePaneTabsCoordinator(
  options: Omit<ProductionCoordinatorOptions, 'runtimeProviders'> & { runtimeProviders: readonly TestRuntimeProvider[] },
) {
  return createProductionWorkspacePaneTabsCoordinator({
    ...options,
    runtimeProviders: options.runtimeProviders.map((provider) => {
      if ('captureSnapshotForUser' in provider) return provider
      return {
        type: provider.type,
        async captureSnapshotForUser(userId: string, scope: string) {
          return { revision: 0, liveSessions: await provider.listSessionsForUser(userId, scope) }
        },
      }
    }),
  })
}

describe('workspace pane tabs coordinator', () => {
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
      runtimeProviders: [{ type: 'terminal', listSessionsForUser: vi.fn(async () => [
        { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
      ]) }],
    })
    const ordered = [workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('history')]
    await expect(coordinator.updateTabs({
      ...workspaceTarget(), repoRoot: REPO_ROOT,
      operation: { type: 'reorder', tabIdentities: ordered.map(workspacePaneTabEntryIdentity) },
      assertCurrent: () => {},
    })).resolves.toEqual(snapshot(2, ordered))
    await expect(coordinator.updateTabs({
      ...workspaceTarget(), repoRoot: REPO_ROOT,
      operation: {
        type: 'open-static', tabType: 'files', insertAfterIdentity: workspacePaneTabEntryIdentity(terminal),
      },
      assertCurrent: () => {},
    })).resolves.toEqual(snapshot(3, [
      workspacePaneStaticTabEntry('status'), terminal, workspacePaneStaticTabEntry('files'), workspacePaneStaticTabEntry('history'),
    ]))
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
      runtimeProviders: [{ type: 'terminal', listSessionsForUser: vi.fn(async () => [
        { sessionId: 'term-openeropeneropenerope1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
        { sessionId: 'term-createdcreatedcreatedcr1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
      ]) }],
    })

    const result = await worktreeOperations.runOperation(capability, async (permit) =>
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

    expect(result).toEqual({ admitted: true, value: snapshot(2, [
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
      opener,
      created,
    ]) })
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
      runtimeProviders: [{ type: 'terminal', listSessionsForUser: vi.fn(async () => [
        { sessionId: 'term-createdcreatedcreatedcr1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
        { sessionId: 'term-otherotherotherotherot1', branch: otherBranch, worktreePath: otherWorktree },
      ]) }],
    })

    const result = await worktreeOperations.runOperation(capability, async (permit) =>
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
    let liveSessions = [
      { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
    ]
    const coordinator = createWorkspacePaneTabsCoordinator({
      workspaceTabs,
      worktreeOperations: createPhysicalWorktreeOperationCoordinator(),
      physicalWorktrees: testPhysicalWorktrees,
      runtimeProviders: [{
        type: 'terminal',
        captureSnapshotForUser: vi.fn(async () => ({ revision: providerRevision, liveSessions })),
      }],
    })

    const withTerminal = await coordinator.listWorkspaceTabs({
      userId: USER_ID, repoRoot: REPO_ROOT, scope: SCOPE, assertCurrent: () => {},
    })
    providerRevision = 2
    liveSessions = []
    const afterClose = await coordinator.listWorkspaceTabs({
      userId: USER_ID, repoRoot: REPO_ROOT, scope: SCOPE, assertCurrent: () => {},
    })

    expect(withTerminal).toEqual(snapshot(1, [
      workspacePaneStaticTabEntry('status'),
      workspacePaneRuntimeTabEntry('terminal', 'term-livelivelivelivelive1'),
    ]))
    expect(afterClose).toEqual(snapshot(2, [workspacePaneStaticTabEntry('status')]))

    providerRevision = 1
    liveSessions = [
      { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
    ]
    await expect(coordinator.listWorkspaceTabs({
      userId: USER_ID, repoRoot: REPO_ROOT, scope: SCOPE, assertCurrent: () => {},
    })).rejects.toThrow('error.workspace-tabs-provider-snapshot-stale')
  })

  test('reconciling one worktree returns provider membership for the full scope', async () => {
    const otherBranch = 'feature/reconcile-other'
    const otherWorktree = '/repo/reconcile-other'
    const workspaceTabs = createWorkspacePaneTabsRuntime<string>()
    replaceTestWorkspaceTabs(workspaceTabs, {
      ...workspaceTarget(), tabs: [workspacePaneStaticTabEntry('status')],
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
      runtimeProviders: [{ type: 'terminal', listSessionsForUser: vi.fn(async () => [
        { sessionId: 'term-currentcurrentcurrentcu1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
        { sessionId: 'term-otherotherotherotherot1', branch: otherBranch, worktreePath: otherWorktree },
      ]) }],
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
      runtimeProviders: [{
        type: 'terminal',
        listSessionsForUser: vi.fn(async () => [
          { sessionId: 'term-livelivelivelivelive1', branch: BRANCH_NAME, worktreePath: WORKTREE_PATH },
        ]),
      }],
    })

    await expect(coordinator.listWorkspaceTabs({
      userId: USER_ID,
      repoRoot: REPO_ROOT,
      scope: SCOPE,
      assertCurrent: () => {},
    })).rejects.toThrow('error.worktree-removal-in-progress')
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
