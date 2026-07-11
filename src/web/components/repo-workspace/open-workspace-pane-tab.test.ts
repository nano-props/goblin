import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openWorkspacePaneTab } from '#/web/components/repo-workspace/open-workspace-pane-tab.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import {
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { dispatchShowWorkspacePaneStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { requestVisibleRepoProjectionRefresh } from '#/web/stores/repos/repo-refresh-actions.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import {
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { beginPrimaryWindowPresentation } from '#/web/primary-window-presentation.ts'

vi.mock('#/web/stores/repos/repo-refresh-actions.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/web/stores/repos/repo-refresh-actions.ts')>()
  return { ...actual, requestVisibleRepoProjectionRefresh: vi.fn() }
})

const REPO_ID = '/tmp/workspace-pane-tab-repo'
const WORKTREE_PATH = '/tmp/workspace-pane-tab-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`
const requestVisibleRefresh = vi.mocked(requestVisibleRepoProjectionRefresh)

beforeEach(() => {
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  setTerminalSessionCommandBridge(null)
  requestVisibleRefresh.mockClear()
})

afterEach(() => {
  resetReposStore()
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
})

function expectVisibleRefreshRequested(branchName: string): void {
  expect(requestVisibleRefresh).toHaveBeenCalledWith(
    expect.objectContaining({ get: useReposStore.getState, set: useReposStore.setState }),
    REPO_ID,
    branchName,
  )
}

describe('openWorkspacePaneTab', () => {
  test('opens status as a target-owned tab when the branch has a worktree', async () => {
    seedWorktreeRepo('status')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'status',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
    expectVisibleRefreshRequested('feature/worktree')
  })

  test('registers changes as a workspace pane static tab and refreshes status', async () => {
    seedWorktreeRepo('changes')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'changes'])
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expectVisibleRefreshRequested('feature/worktree')
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
        repoId: REPO_ID,
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
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
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
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        type: 'changes',
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toMatchObject({ kind: 'completed' })

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'files', 'history', 'changes'])
    expect(
      useReposStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:files')
  })

  test('ignores an appended terminal close-back opener when placing a tab opened from status', async () => {
    const branchName = 'feature/worktree'
    const terminalSessionId = 'term-111111111111111111111'
    const terminalEntry = workspacePaneRuntimeTabEntry('terminal', terminalSessionId)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), terminalEntry, workspacePaneStaticTabEntry('history')],
      },
    })
    expect(
      recordWorkspacePaneTabOpener(
        REPO_ID,
        repo.repoRuntimeId,
        branchName,
        workspacePaneTabEntryIdentity(terminalEntry),
        'workspace-pane:status',
      ),
    ).toBe('recorded')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        repoId: REPO_ID,
        branchName,
        worktreePath: WORKTREE_PATH,
        type: 'files',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(
      readWorkspacePaneTabsForTarget({
        repoRoot: REPO_ID,
        repoRuntimeId: repo.repoRuntimeId,
        branchName,
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
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(false)

    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('status')
    expect(openTabsFor('feature/no-worktree')).toEqual(['status'])
    expect(requestVisibleRefresh).not.toHaveBeenCalled()
  })

  test('opens status for a branch without a worktree', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/no-worktree': [workspacePaneStaticTabEntry('status')],
      },
    })

    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        worktreePath: null,
        type: 'status',
        navigation: navigationWithStoreActions(showRepoBranchWorkspacePaneTab),
      }),
    ).resolves.toBe(true)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/no-worktree')).toBe('changes')
  })

  test('opens history as a branch-static workspace pane tab', async () => {
    seedWorktreeRepo('history')

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'history',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(openTabsFor('feature/worktree')).toContain('history')
    expect(preferredWorkspacePaneTab()).toBe('history')
    expect(requestVisibleRefresh).not.toHaveBeenCalled()
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
        repoId: REPO_ID,
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
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })

    await expect(
      openWorkspacePaneTab({
        workspacePaneRoute: undefined,
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
        type: 'changes',
        navigation: navigationWithStoreActions(),
      }),
    ).resolves.toBe(true)

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:files')
  })

  test('does not overwrite the recorded opener when refocusing an already-open static tab', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    // Switch away, then "reopen" (i.e. just refocus) the already-open
    // changes tab from a different tab — the original opener must stick.
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'history')
    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)]?.[
        'workspace-pane:changes'
      ],
    ).toBe('workspace-pane:files')
  })

  test('records the opener under the branch the operation targeted, even if the user switches branches while the commit is in flight', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } }), createRepoBranch('feature/b')],
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
      repoId: REPO_ID,
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

    const openers = useReposStore.getState().tabOpenerIdentityByScope
    // Recorded under feature/a's workspace pane target (the operation target)...
    expect(openers[openerScopeKey(REPO_ID, 'feature/a', WORKTREE_PATH)]?.['workspace-pane:changes']).toBe(
      'workspace-pane:files',
    )
    // ...never under feature/b's branch-only target (the branch that merely
    // happened to be selected by the time the commit resolved).
    expect(openers[openerScopeKey(REPO_ID, 'feature/b', null)]).toBeUndefined()
  })

  test('does not record an opener when the server rejects a stale repo runtime commit', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } })],
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
      repoId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await commitStarted

    useReposStore.getState().closeRepo(REPO_ID)
    rejectCommit(new Error('error.repo-runtime-stale'))
    await expect(openPromise).resolves.toBe(false)

    expect(
      useReposStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/a', WORKTREE_PATH)],
    ).toBeUndefined()
  })

  test('does not select a stale opened tab when the server rejects a stale repo runtime commit', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } })],
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
      const state = useReposStore.getState()
      useReposStore.setState({ restoredRepoId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    })

    const openPromise = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      repoId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(showRepoBranchWorkspacePaneTab),
    })
    await commitStarted

    useReposStore.getState().closeRepo(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/reopened',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/reopened': [workspacePaneStaticTabEntry('status')],
      },
    })
    rejectCommit(new Error('error.repo-runtime-stale'))

    await expect(openPromise).resolves.toBe(false)

    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/reopened')).toBe('status')
  })

  test('does not select a stale opened tab when the old repo runtime commit succeeds after reopen', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a', { worktree: { path: WORKTREE_PATH } })],
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
      const state = useReposStore.getState()
      useReposStore.setState({ restoredRepoId: repoId })
      state.setWorkspacePaneTab(repoId, branch, tab)
      return true
    })

    const openPromise = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      repoId: REPO_ID,
      branchName: 'feature/a',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(showRepoBranchWorkspacePaneTab),
    })
    await commitStarted

    useReposStore.getState().closeRepo(REPO_ID)
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      repoRuntimeId: 'repo-runtime-reopened',
      branches: [createRepoBranch('feature/reopened', { worktree: { path: WORKTREE_PATH } })],
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
      useReposStore.getState().tabOpenerIdentityByScope[openerScopeKey(REPO_ID, 'feature/a', WORKTREE_PATH)],
    ).toBeUndefined()
    expect(preferredWorkspacePaneTab('feature/reopened')).toBe('status')
  })

  test('scopes recorded openers per workspace pane target so identical static tab identities do not bleed', async () => {
    const OTHER_REPO_ID = '/tmp/workspace-pane-tab-other-repo'
    const OTHER_WORKTREE_PATH = '/tmp/workspace-pane-tab-other-worktree'
    // seedRepoWithReadModelForTest replaces the whole `repos` map, so seed both repos
    // before merging them back together into one multi-repo store state.
    const repoA = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const repoB = seedRepoWithReadModelForTest({
      id: OTHER_REPO_ID,
      branches: [createRepoBranch('main', { worktree: { path: OTHER_WORKTREE_PATH } })],
      currentBranchName: 'main',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        main: [workspacePaneStaticTabEntry('status')],
      },
    })
    useReposStore.setState({
      repos: { [REPO_ID]: repoA, [OTHER_REPO_ID]: repoB },
      order: [REPO_ID, OTHER_REPO_ID],
      restoredRepoId: REPO_ID,
    })

    await openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      repoId: REPO_ID,
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
      repoId: OTHER_REPO_ID,
      branchName: 'main',
      worktreePath: OTHER_WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })

    const openers = useReposStore.getState().tabOpenerIdentityByScope
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
          repoId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type: 'changes',
          navigation: navigationWithStoreActions(),
        }),
        openWorkspacePaneTab({
          workspacePaneRoute: undefined,
          repoId: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          type: 'history',
          navigation: navigationWithStoreActions(),
        }),
      ]),
    ).resolves.toEqual([true, true])

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history', 'changes'])
    const openers = useReposStore.getState().tabOpenerIdentityByScope
    const scope = openers[openerScopeKey(REPO_ID, 'feature/worktree', WORKTREE_PATH)]
    expect(scope?.['workspace-pane:changes']).toBe('workspace-pane:status')
    expect(scope?.['workspace-pane:history']).toBe('workspace-pane:status')
  })

  test('refreshes a committed open even when a newer presentation supersedes its route', async () => {
    seedWorktreeRepo('status')
    const mutation = Promise.withResolvers<WorkspacePaneTabEntry[]>()
    installWorkspacePaneTabsTestBridge({ updateWorkspaceTabs: async () => await mutation.promise })

    const opened = openWorkspacePaneTab({
      workspacePaneRoute: undefined,
      repoId: REPO_ID,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      type: 'changes',
      navigation: navigationWithStoreActions(),
    })
    await Promise.resolve()
    beginPrimaryWindowPresentation()
    mutation.resolve([workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')])

    await expect(opened).resolves.toBe(true)
    expectVisibleRefreshRequested('feature/worktree')
  })
})

function seedWorktreeRepo(preferredWorkspacePaneTab: WorkspacePaneStaticTabType) {
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: 'feature/worktree',
    preferredWorkspacePaneTab,
    workspacePaneTabsByBranch: {
      'feature/worktree': [workspacePaneStaticTabEntry('status')],
    },
  })
}

function openTabsFor(branchName: string): WorkspacePaneStaticTabType[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branchName,
      )
    : null
  return workspacePaneStaticTabsFromEntries(
    target ? readWorkspacePaneTabsForTarget({ ...target, repoRuntimeId: repo.repoRuntimeId }) : [],
  )
}

function preferredWorkspacePaneTab(branchName = 'feature/worktree') {
  const repo = useReposStore.getState().repos[REPO_ID]
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
  const baseKey = tabOpenerScopeKey({ repoRoot, branchName, worktreePath })
  const repoRuntimeId = useReposStore.getState().repos[repoRoot]?.repoRuntimeId
  if (repoRuntimeId) return `${baseKey}\0${repoRuntimeId}`
  return (
    Object.keys(useReposStore.getState().tabOpenerIdentityByScope).find((key) => key.startsWith(`${baseKey}\0`)) ??
    `${baseKey}\0missing-runtime`
  )
}

function navigationWithStoreActions(
  showRepoBranchWorkspacePaneTab: PrimaryWindowNavigationActions['showRepoBranchWorkspacePaneTab'] = (
    repoId,
    branch,
    tab,
  ) => {
    const state = useReposStore.getState()
    useReposStore.setState({ restoredRepoId: repoId })
    state.setWorkspacePaneTab(repoId, branch, tab)
    return true
  },
): Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab' | 'commitRepoBranchWorkspacePaneRoute'> {
  seedInitialObservedWorkspacePaneRouteForTest()
  const navigation: Pick<PrimaryWindowNavigationActions, 'showRepoBranchWorkspacePaneTab'> = {
    showRepoBranchWorkspacePaneTab,
  }
  return {
    ...navigation,
    commitRepoBranchWorkspacePaneRoute: observedWorkspacePaneRouteCommitForTest({
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
