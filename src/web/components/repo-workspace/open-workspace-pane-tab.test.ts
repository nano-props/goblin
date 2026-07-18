import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createBranchSnapshot,
  installWorkspacePaneTabsTestBridge,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import { tabOpenerScopeKey } from '#/web/stores/workspaces/tab-opener.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import {
  observeWorkspacePaneRouteForTest,
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { beginPrimaryWindowPresentation } from '#/web/primary-window-presentation.ts'
import { requestVisibleWorkspaceStatusRefresh } from '#/web/stores/workspaces/repo-refresh-actions.ts'

vi.mock('#/web/stores/workspaces/repo-refresh-actions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/workspaces/repo-refresh-actions.ts')>()
  return { ...actual, requestVisibleWorkspaceStatusRefresh: vi.fn(() => true) }
})

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-repo')
const WORKTREE_PATH = '/tmp/workspace-pane-tab-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  resetWorkspacesStore()
  installWorkspacePaneTabsTestBridge()
  setTerminalSessionCommandBridge(null)
  vi.mocked(requestVisibleWorkspaceStatusRefresh).mockReset()
  vi.mocked(requestVisibleWorkspaceStatusRefresh).mockReturnValue(true)
})

afterEach(() => {
  resetWorkspacesStore()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

describe('openWorkspacePaneTab', () => {
  test('opens status as a target-owned tab when the branch has a worktree', async () => {
    seedWorktreeRepo('status')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
  })

  test('registers changes as a workspace pane static tab', async () => {
    seedWorktreeRepo('changes')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneTab()).toBe('changes')
  })

  test('can insert a newly opened static tab immediately after a specific tab', async () => {
    seedWorktreeRepo('status')
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: async (input) => {
        expect(input.operation).toEqual({
          type: 'open-static',
          tabType: 'changes',
          insertAfterIdentity: 'workspace-pane:status',
        })
        return [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')]
      },
    })

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneTab()).toBe('changes')
  })

  test('can explicitly append a newly opened static tab while still recording the opener', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneStaticTabEntry('files'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
    })

    await expect(
      dispatchShowWorkspacePaneStaticTabAction({
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        type: 'changes',
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toMatchObject({ kind: 'completed' })

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'files', 'history', 'changes'])
    expect(
      useWorkspacesStore.getState().tabOpenerIdentityByScope[
        openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)
      ]?.['workspace-pane:changes'],
    ).toBe('workspace-pane:files')
  })

  test('ignores an appended terminal close-back opener when placing a tab opened from status', async () => {
    const branchName = 'feature/worktree'
    const terminalSessionId = 'term-111111111111111111111'
    const terminalEntry = workspacePaneRuntimeTabEntry('terminal', terminalSessionId)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), terminalEntry, workspacePaneStaticTabEntry('history')],
      },
    })
    expect(
      recordWorkspacePaneTabOpener(
        {
          kind: 'git-worktree',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
        },
        repo.workspaceRuntimeId,
        workspacePaneTabEntryIdentity(terminalEntry),
        'workspace-pane:status',
      ),
    ).toBe('recorded')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        workspaceId: REPO_ID,
        branchName,
        worktreePath: WORKTREE_PATH,
        type: 'files',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(
      readWorkspacePaneTabsForTarget({
        kind: 'git-worktree' as const,
        repoRoot: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        worktreePath: WORKTREE_PATH,
      }).map(workspacePaneTabEntryIdentity),
    ).toEqual([
      'workspace-pane:status',
      'workspace-pane:files',
      `terminal:${terminalSessionId}`,
      'workspace-pane:history',
    ])
  })

  test('does not select changes when the selected branch has no worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('status')
    expect(openTabsFor('feature/no-worktree')).toEqual(['status'])
  })

  test('opens status for a branch without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const navigation = navigationWithStoreActions(showRepoBranchWorkspacePaneTab)
    const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId,
      branchName: 'feature/no-worktree',
      worktreePath: null,
      route: null,
    })
    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'status',
        navigation,
      }),
    ).resolves.toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'status')
    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('status')
  })

  test('opens history as a branch-static workspace pane tab', async () => {
    seedWorktreeRepo('history')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toContain('history')
    expect(preferredWorkspacePaneTab()).toBe('history')
  })

  test.each(['status', 'changes', 'files'] satisfies WorkspacePaneStaticTabType[])(
    'refreshes repo-scoped visible status after opening %s',
    async (type) => {
      seedWorktreeRepo(type)
      const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId

      await expect(
        openWorkspacePaneTab({
          workspacePaneRoute: undefined,
          workspaceId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type,
          navigation: navigationWithStoreActions(),
        }),
      ).resolves.toBe(true)

      expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledOnce()
      expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledWith(
        expect.any(Object),
        REPO_ID,
        workspaceRuntimeId,
        'feature/worktree',
      )
    },
  )

  test('does not refresh visible status after opening history', async () => {
    seedWorktreeRepo('history')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(requestVisibleWorkspaceStatusRefresh).not.toHaveBeenCalled()
  })

  test('fast-fails before static tab mutation while terminal creation is pending', async () => {
    seedWorktreeRepo('status')
    const updateWorkspaceTabs = vi.fn(async () => [workspacePaneStaticTabEntry('status')])
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshot({ createPending: true }),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(updateWorkspaceTabs).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
  })

  test('records the active tab as the opener when opening a new static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(
      useWorkspacesStore.getState().tabOpenerIdentityByScope[
        openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)
      ]?.['workspace-pane:changes'],
    ).toBe('workspace-pane:files')
  })

  test('does not overwrite the recorded opener when refocusing an already-open static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    // Switch away, then "reopen" (i.e. just refocus) the already-open
    // changes tab from a different tab — the original opener must stick.
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'history')
    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    expect(
      useWorkspacesStore.getState().tabOpenerIdentityByScope[
        openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)
      ]?.['workspace-pane:changes'],
    ).toBe('workspace-pane:files')
  })

  test('records the opener under the branch the operation targeted, even if the user switches branches while the commit is in flight', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/a', { worktree: { path: WORKTREE_PATH } }),
        createBranchSnapshot('feature/b'),
      ],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let resolveCommit!: (tabs: ReturnType<typeof workspacePaneStaticTabEntry>[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    const openPromise = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await commitStarted

    resolveCommit([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('files'),
      workspacePaneStaticTabEntry('changes'),
    ])
    await openPromise

    const openers = useWorkspacesStore.getState().tabOpenerIdentityByScope
    // Recorded under feature/a's workspace pane target (the operation target)...
    expect(openers[openerScopeKey(REPO_ID, 'feature/a', WORKTREE_PATH)]?.['workspace-pane:changes']).toBe(
      'workspace-pane:files',
    )
    // ...never under feature/b's branch-only target (the branch that merely
    // happened to be selected by the time the commit resolved).
    expect(openers[openerScopeKey(REPO_ID, 'feature/b', null)]).toBeUndefined()
  })

  test('does not record an opener when the server rejects a stale workspace runtime commit', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let rejectCommit!: (error: unknown) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((_, reject) => {
          rejectCommit = reject
        })
      },
    })

    const openPromise = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await commitStarted

    await useWorkspacesStore.getState().closeWorkspace(REPO_ID)
    rejectCommit(new Error('error.workspace-runtime-stale'))
    await expect(openPromise).resolves.toBe(false)

    expect(
      useWorkspacesStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/a', WORKTREE_PATH)],
    ).toBeUndefined()
  })

  test('does not select a stale opened tab when the server rejects a stale workspace runtime commit', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let rejectCommit!: (error: unknown) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((_, reject) => {
          rejectCommit = reject
        })
      },
    })

    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      const state = useWorkspacesStore.getState()
      useWorkspacesStore.setState({ restoredWorkspaceId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    })

    const openPromise = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(showRepoBranchWorkspacePaneTab),
    })
    await commitStarted

    await useWorkspacesStore.getState().closeWorkspace(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/reopened',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/reopened': [workspacePaneStaticTabEntry('status')],
      },
    })
    rejectCommit(new Error('error.workspace-runtime-stale'))

    await expect(openPromise).resolves.toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/reopened')).toBe('status')
  })

  test('does not select a stale opened tab when the old workspace runtime commit succeeds after reopen', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/a', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    let resolveCommit!: (tabs: ReturnType<typeof workspacePaneStaticTabEntry>[]) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      const state = useWorkspacesStore.getState()
      useWorkspacesStore.setState({ restoredWorkspaceId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    })

    const openPromise = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(showRepoBranchWorkspacePaneTab),
    })
    await commitStarted

    await useWorkspacesStore.getState().closeWorkspace(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-reopened',
      branchSnapshots: [createBranchSnapshot('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/reopened',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/reopened': [workspacePaneStaticTabEntry('status')],
      },
    })
    resolveCommit([
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('files'),
      workspacePaneStaticTabEntry('changes'),
    ])

    await expect(openPromise).resolves.toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(
      useWorkspacesStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/a', WORKTREE_PATH)],
    ).toBeUndefined()
    expect(preferredWorkspacePaneTab('feature/reopened')).toBe('status')
  })

  test('scopes recorded openers per workspace pane target so identical static tab identities do not bleed', async () => {
    const OTHER_REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-other-repo')
    const OTHER_WORKTREE_PATH = '/tmp/workspace-pane-tab-other-worktree'
    // seedRepoWithReadModelForTest replaces the whole `repos` map, so seed both repos
    // before merging them back together into one multi-repo store state.
    const repoA = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const repoB = seedRepoWithReadModelForTest({
      id: OTHER_REPO_ID,
      branchSnapshots: [createBranchSnapshot('main', { worktree: { path: OTHER_WORKTREE_PATH } })],
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        main: [workspacePaneStaticTabEntry('status')],
      },
    })
    useWorkspacesStore.setState({
      workspaces: { [REPO_ID]: repoA, [OTHER_REPO_ID]: repoB },
      workspaceOrder: [REPO_ID, OTHER_REPO_ID],
      restoredWorkspaceId: REPO_ID,
    })

    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    // A second, unrelated repo also opens "changes" — this time from
    // "status". Both repos share the identity string `workspace-pane:changes`,
    // so without scoping this would clobber the first repo's recorded opener.
    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: OTHER_REPO_ID,
      branchName: 'main',
      worktreePath: OTHER_WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    const openers = useWorkspacesStore.getState().tabOpenerIdentityByScope
    expect(openers[openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)]?.['workspace-pane:changes']).toBe(
      'workspace-pane:files',
    )
    expect(openers[openerScopeKey(OTHER_REPO_ID, 'main', OTHER_WORKTREE_PATH)]?.['workspace-pane:changes']).toBe(
      'workspace-pane:status',
    )
  })

  test('captures concurrent static tab openers before coordinator serialization', async () => {
    seedWorktreeRepo('status')

    await expect(
      Promise.all([
        openWorkspacePaneTab({
          workspacePaneRoute: undefined,
          workspaceId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type: 'changes',
          navigation: navigationWithStoreActions(),
        }),
        openWorkspacePaneTab({
          workspacePaneRoute: undefined,
          workspaceId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type: 'history',
          navigation: navigationWithStoreActions(),
        }),
      ]),
    ).resolves.toEqual([true, true])

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history', 'changes'])
    const openers = useWorkspacesStore.getState().tabOpenerIdentityByScope
    const scope = openers[openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)]
    expect(scope?.['workspace-pane:changes']).toBe('workspace-pane:status')
    expect(scope?.['workspace-pane:history']).toBe('workspace-pane:status')
  })

  test('refreshes a committed open even when a newer presentation supersedes its route', async () => {
    seedWorktreeRepo('status')
    const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId
    const mutation = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: async () => await mutation.promise })

    const opened = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await Promise.resolve()
    beginPrimaryWindowPresentation()
    mutation.resolve([workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')])

    await expect(opened).resolves.toBe(true)
    expect(requestVisibleWorkspaceStatusRefresh).toHaveBeenCalledWith(
      expect.any(Object),
      REPO_ID,
      workspaceRuntimeId,
      'feature/worktree',
    )
  })
})

function seedWorktreeRepo(preferredWorkspacePaneTab: WorkspacePaneStaticTabType) {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branchSnapshots: [createBranchSnapshot('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    preferredWorkspacePaneTab,
    workspacePaneTabsByBranch: {
      'feature/worktree': [workspacePaneStaticTabEntry('status')],
    },
  })
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branchName,
      )
    : null
  return workspacePaneStaticTabsFromEntries(
    target ? readWorkspacePaneTabsForTarget({ ...target, workspaceRuntimeId: repo.workspaceRuntimeId }) : [],
  )
}

function preferredWorkspacePaneTab(branchName = 'feature/worktree') {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          branchName,
        ),
      )
    : null
}

function openerScopeKey(repoRoot: string, branchName: string, worktreePath: string | null): string {
  const target =
    worktreePath === null
      ? { kind: 'git-branch' as const, repoRoot, branchName }
      : {
          kind: 'git-worktree' as const,
          repoRoot,
          worktreePath,
          head: { kind: 'branch' as const, branchName },
        }
  const baseKey = tabOpenerScopeKey(target)
  const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[repoRoot]?.workspaceRuntimeId
  if (workspaceRuntimeId) return `${baseKey}\0${workspaceRuntimeId}`
  return (
    Object.keys(useWorkspacesStore.getState().tabOpenerIdentityByScope).find((key) => key.startsWith(`${baseKey}\0`)) ??
    `${baseKey}\0missing-runtime`
  )
}

function navigationWithStoreActions(
  showRepoBranchWorkspacePaneTab: PrimaryWindowNavigationActions['showRepoBranchWorkspacePaneTab'] = (
    repoId,
    branch,
    tab,
  ) => {
    const state = useWorkspacesStore.getState()
    const workspaceId = workspaceIdForTest(repoId)
    useWorkspacesStore.setState({ restoredWorkspaceId: workspaceId })
    state.setWorkspacePaneTab(workspaceId, branch, tab)
    return true
  },
): Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab' | 'commitWorkspacePaneRoute'> {
  seedInitialObservedWorkspacePaneRouteForTest()
  const navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'> = {
    showRepoBranchWorkspacePaneTab,
  }
  return {
    ...navigation,
    commitWorkspacePaneRoute: observedWorkspacePaneRouteCommitForTest({
      showRepoBranchEmptyWorkspacePane: () => false,
      showRepoBranchWorkspacePaneTab: navigation.showRepoBranchWorkspacePaneTab,
      showRepoBranchTerminalSession: () => false,
    }),
  }
}

function worktreeSnapshot(input: { createPending: boolean }): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: input.createPending,
  }
}
