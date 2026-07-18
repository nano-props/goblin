import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPrimaryWindowNavigationActions as createPrimaryWindowNavigationActionsCore } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { setTerminalSessionCommandBridgeForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspaceNavigationHistoryEntry, WorkspaceNavigationHistoryTraversal } from '#/web/stores/repos/types.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'

const REPO_ID = 'goblin+file:///tmp/navigation-actions-repo'
const BRANCH_NAME = 'feature/create-pending'
const presentationOptions = (options: { replace?: boolean; returnTo?: string | null } = {}) =>
  expect.objectContaining({ ...options, presentationToken: expect.any(Object) })
const WORKTREE_PATH = '/tmp/navigation-actions-worktree'
const WORKTREE_KEY = formatTerminalWorktreeKeyForPath(REPO_ID, WORKTREE_PATH)

beforeEach(() => {
  resetReposStore()
  setTerminalSessionCommandBridge(null)
})

describe('createPrimaryWindowNavigationActions', () => {
  test('presents a workspace-root tab through the workspace route and commits its preference', () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    expect(actions.showWorkspaceRootPaneTab?.(REPO_ID, { kind: 'static', tab: 'files' })).toBe(true)
    expect(navigation.openWorkspaceRootPane).toHaveBeenCalledWith(
      REPO_ID,
      expect.objectContaining({ presentationToken: expect.any(Object), onCommit: expect.any(Function) }),
    )
    expect(
      preferredWorkspacePaneTabForTarget(useReposStore.getState().repos[REPO_ID]!.ui, {
        kind: 'workspace-root',
        repoRoot: REPO_ID,
      }),
    ).toBe('files')
  })

  test.each([
    ['rejected', false, false],
    ['superseded', true, false],
    ['committed', true, true],
  ] as const)(
    'keeps workspace terminal selection and preference atomic when presentation is %s',
    (_state, accepted, commit) => {
      const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      const terminalKey = formatTerminalWorktreeKeyForPath(REPO_ID, REPO_ID)
      useReposStore.getState().setSelectedTerminal(terminalKey, 'term-111111111111111111111')
      useReposStore
        .getState()
        .setWorkspacePaneTabForTarget({ kind: 'workspace-root', repoRoot: REPO_ID }, 'files')
      const navigation = routeNavigation()
      vi.mocked(navigation.openWorkspaceRootPane).mockImplementation((_repoId, options) => {
        if (accepted && commit) options?.onCommit?.()
        return accepted
      })
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: REPO_ID,
        order: [REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      expect(
        actions.showWorkspaceRootPaneTab?.(REPO_ID, {
          kind: 'terminal',
          terminalSessionId: 'term-222222222222222222222',
        }),
      ).toBe(accepted)
      expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalKey]).toBe(
        commit ? 'term-222222222222222222222' : 'term-111111111111111111111',
      )
      expect(
        preferredWorkspacePaneTabForTarget(useReposStore.getState().repos[repo.id]!.ui, {
          kind: 'workspace-root',
          repoRoot: repo.id,
        }),
      ).toBe(commit ? 'terminal' : 'files')
    },
  )

  test('activates a non-Git workspace at its Dashboard without restoring Git navigation history', () => {
    seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [REPO_ID]: {
          ...state.repos[REPO_ID]!,
          workspaceProbe: {
            status: 'ready',
            name: 'workspace',
            capabilities: {
              files: { read: true, write: true },
              terminal: { available: true },
              git: { status: 'unavailable' },
            },
            diagnostics: [],
          },
        },
      },
      navigationHistoryByRepo: {
        ...state.navigationHistoryByRepo,
        [REPO_ID]: {
          backStack: [],
          current: { repoId: REPO_ID, route: { kind: 'dashboard' } },
          forwardStack: [],
        },
      },
    }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: null,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(navigation.openRepoRoot).not.toHaveBeenCalled()
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test.each(['workspace-root', 'dashboard'] as const)(
    'activates a non-Git workspace at its last %s presentation',
    (kind) => {
      seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      markRepoGitUnavailable(REPO_ID)
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind } })
      const navigation = routeNavigation()
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: 'goblin+file:///tmp/other-workspace',
        order: ['goblin+file:///tmp/other-workspace', REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      actions.activateWorkspace(REPO_ID)

      if (kind === 'workspace-root') {
        expect(navigation.openWorkspaceRootPane).toHaveBeenCalledWith(REPO_ID, presentationOptions())
        expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
      } else {
        expect(navigation.openRepoDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
        expect(navigation.openWorkspaceRootPane).not.toHaveBeenCalled()
      }
    },
  )

  test.each([
    { kind: 'branch', branchName: 'feature/stale', workspacePaneTab: null, terminalWorktreeKey: null, terminalSessionId: null },
    { kind: 'worktree', worktreePath: '/tmp/stale-worktree', workspacePaneTab: 'files' as const, terminalSessionId: null },
    { kind: 'newWorktree', returnTo: null },
  ] satisfies WorkspaceNavigationHistoryEntry['route'][])(
    'falls back to Dashboard instead of restoring stale non-Git $kind history',
    (route) => {
      seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
      markRepoGitUnavailable(REPO_ID)
      useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route })
      const navigation = routeNavigation()
      const openRepoWorktreeTab = vi.fn(() => true)
      navigation.openRepoWorktreeTab = openRepoWorktreeTab
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: 'goblin+file:///tmp/other-workspace',
        order: ['goblin+file:///tmp/other-workspace', REPO_ID],
        closeWorkspace: vi.fn(),
        routeNavigation: navigation,
      })

      actions.activateWorkspace(REPO_ID)

      expect(navigation.openRepoDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
      expect(navigation.openRepoBranch).not.toHaveBeenCalled()
      expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
      expect(navigation.openRepoWorktree).not.toHaveBeenCalled()
      expect(openRepoWorktreeTab).not.toHaveBeenCalled()
      expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
    },
  )

  test('selects branches by resolving the branch workspace pane route', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME, { replace: true })

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      'status',
      presentationOptions({ replace: true }),
    )
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test('opens the branch root while workspace pane tabs are still loading', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME, { replace: true })

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions({ replace: true }))
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('opens the branch root when workspace pane tab restoration failed', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: workspacePaneTabsQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    await primaryWindowQueryClient
      .fetchQuery({
        queryKey: workspacePaneTabsQueryKey(REPO_ID, repo.workspaceRuntimeId),
        queryFn: async () => {
          throw new Error('tabs unavailable')
        },
        retry: false,
      })
      .catch(() => undefined)
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME)

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('selects branches by falling back when the preferred workspace pane tab is stale', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'status', presentationOptions())
    expect(navigation.openRepoBranch).not.toHaveBeenCalled()
  })

  test('selects branches with an intentional empty workspace pane route', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: null,
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.selectRepoBranch(REPO_ID, BRANCH_NAME)

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('opens explicit empty branch routes through route navigation', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchEmptyWorkspacePane('goblin+file:///tmp/repo-b', 'feature/test', { replace: true })

    expect(navigation.openRepoBranch).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-b',
      'feature/test',
      presentationOptions({ replace: true }),
    )
  })

  test('opens branch workspace static tabs through route navigation', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchWorkspacePaneTab('goblin+file:///tmp/repo-b', 'feature/test', 'history')

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-b',
      'feature/test',
      'history',
      presentationOptions(),
    )
  })

  test('does not block explicit workspace pane route navigation while tabs projection is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchWorkspacePaneTab(REPO_ID, BRANCH_NAME, 'history')

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, 'history', presentationOptions())
    expect(preferredWorkspacePaneTab()).toBe('history')
  })

  test('opens branch terminal sessions through route navigation', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchTerminalSession(REPO_ID, BRANCH_NAME, 'term-111111111111111111111')

    expect(navigation.openRepoBranchTerminal).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      'term-111111111111111111111',
      presentationOptions(),
    )
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe(
      'term-111111111111111111111',
    )
  })

  test('blocks workspace pane route navigation while terminal creation is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.showRepoBranchWorkspacePaneTab(REPO_ID, BRANCH_NAME, 'history')
    actions.showRepoBranchTerminalSession(REPO_ID, BRANCH_NAME, 'term-111111111111111111111')

    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('keeps command-owned route commits free of workspace pane supplements', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    const accepted = actions.commitWorkspacePaneRoute(REPO_ID, BRANCH_NAME, {
      kind: 'terminal',
      terminalSessionId: 'term-111111111111111111111',
    })

    expect(accepted).toBe(true)
    expect(navigation.openRepoBranchTerminal).toHaveBeenCalledWith(
      REPO_ID,
      BRANCH_NAME,
      'term-111111111111111111111',
      presentationOptions(),
    )
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('does not commit route supplements when operation-owned navigation settles', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [BRANCH_NAME]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const routeCommit = Promise.withResolvers<boolean>()
    const navigation = routeNavigation()
    navigation.commitWorkspacePaneRoute = vi.fn(() => routeCommit.promise)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    const committed = actions.commitWorkspacePaneRoute(REPO_ID, BRANCH_NAME, {
      kind: 'static',
      tab: 'history',
    })
    expect(preferredWorkspacePaneTab()).toBe('status')

    routeCommit.resolve(true)
    await expect(committed).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('blocks workspace history restore before mutating history while terminal creation is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const dashboard = {
      repoId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    const branch = {
      repoId: REPO_ID,
      route: {
        kind: 'branch',
        branchName: BRANCH_NAME,
        workspacePaneTab: 'status',
        terminalWorktreeKey: WORKTREE_KEY,
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    useReposStore.getState().recordWorkspaceNavigation(dashboard)
    useReposStore.getState().recordWorkspaceNavigation(branch)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const peekWorkspaceNavigation = vi.fn((repoId: string, direction: 'back' | 'forward') =>
      useReposStore.getState().peekWorkspaceNavigation(repoId, direction),
    )
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation: useReposStore.getState().commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(peekWorkspaceNavigation).not.toHaveBeenCalled()
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(branch)
  })

  test('cycles repos by navigating from the current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b', 'goblin+file:///tmp/repo-c'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(1)

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('goblin+file:///tmp/repo-b', presentationOptions())
  })

  test('activates a repo at its current workspace history entry', () => {
    const entry = branchHistoryEntry('goblin+file:///tmp/repo-b', 'feature/remembered', 'history')
    useReposStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace('goblin+file:///tmp/repo-b')

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-b',
      'feature/remembered',
      'history',
      presentationOptions(),
    )
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
  })

  test('does not resume a repo at its new-worktree workflow', () => {
    useReposStore.getState().recordWorkspaceNavigation({
      repoId: 'goblin+file:///tmp/repo-b',
      route: { kind: 'newWorktree', returnTo: '/repo/repo-b/branch/main' },
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace('goblin+file:///tmp/repo-b')

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('goblin+file:///tmp/repo-b', presentationOptions())
    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })

  test('does not replace a blocked repo history restore with the dashboard', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const entry = branchHistoryEntry(REPO_ID, BRANCH_NAME, 'status')
    useReposStore.getState().recordWorkspaceNavigation(entry)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(entry)
  })

  test('falls back to the dashboard when a repo history route is unavailable', () => {
    const entry = branchHistoryEntry('goblin+file:///tmp/repo-b', 'feature/remembered', 'history')
    useReposStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    vi.mocked(navigation.openRepoBranchTab).mockReturnValue(false)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace('goblin+file:///tmp/repo-b')

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('goblin+file:///tmp/repo-b', presentationOptions())
  })

  test('falls back to the dashboard when workspace-root history cannot be presented', () => {
    const workspaceId = 'goblin+file:///tmp/workspace-b'
    useReposStore.getState().recordWorkspaceNavigation({
      repoId: workspaceId,
      route: { kind: 'workspace-root' },
    })
    const navigation = routeNavigation()
    vi.mocked(navigation.openWorkspaceRootPane).mockReturnValue(false)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/workspace-a',
      order: ['goblin+file:///tmp/workspace-a', workspaceId],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(workspaceId)

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith(workspaceId, presentationOptions())
  })

  test('cycles to the target repo current workspace history entry', () => {
    const entry = branchHistoryEntry('goblin+file:///tmp/repo-b', 'feature/remembered', 'status')
    useReposStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(1)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-b',
      'feature/remembered',
      'status',
      presentationOptions(),
    )
  })

  test('cycles repos backward and wraps around', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b', 'goblin+file:///tmp/repo-c'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(-1)

    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('goblin+file:///tmp/repo-c', presentationOptions())
  })

  test('closes the repo through the store action without navigation when it is not current', async () => {
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b', 'goblin+file:///tmp/repo-c'],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace('goblin+file:///tmp/repo-b')

    expect(closeWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/repo-b')
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
  })

  test('closes the current repo and navigates to the next repo dashboard without history', async () => {
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-b',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b', 'goblin+file:///tmp/repo-c'],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace('goblin+file:///tmp/repo-b')

    expect(closeWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/repo-b')
    expect(navigation.openRepoDashboard).toHaveBeenCalledWith('goblin+file:///tmp/repo-c', presentationOptions())
  })

  test('closes the current repo and restores the next repo workspace history entry', async () => {
    useReposStore
      .getState()
      .recordWorkspaceNavigation(branchHistoryEntry('goblin+file:///tmp/repo-c', 'feature/remembered', 'history'))
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-b',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b', 'goblin+file:///tmp/repo-c'],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace('goblin+file:///tmp/repo-b')

    expect(closeWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/repo-b')
    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-c',
      'feature/remembered',
      'history',
      presentationOptions(),
    )
  })

  test('closes the current repo into the next repo dashboard when its history restore is blocked', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const entry = branchHistoryEntry(REPO_ID, BRANCH_NAME, 'status')
    useReposStore.getState().recordWorkspaceNavigation(entry)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
    })
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', REPO_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace('goblin+file:///tmp/repo-a')

    expect(closeWorkspace).toHaveBeenCalledWith('goblin+file:///tmp/repo-a')
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(entry)
  })

  test('closes the final current repo and navigates home', async () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a'],
      closeWorkspace: vi.fn(async () => ({ ok: true as const })),
      routeNavigation: navigation,
    })

    await actions.closeWorkspace('goblin+file:///tmp/repo-a')

    expect(navigation.openHome).toHaveBeenCalled()
  })

  test('keeps the current route when the shared workspace close fails', async () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
      closeWorkspace: vi.fn(async () => ({ ok: false as const, message: 'error.failed-read-repo' })),
      routeNavigation: navigation,
    })

    await expect(actions.closeWorkspace('goblin+file:///tmp/repo-a')).resolves.toEqual({
      ok: false,
      message: 'error.failed-read-repo',
    })
    expect(navigation.openRepoDashboard).not.toHaveBeenCalled()
    expect(navigation.openHome).not.toHaveBeenCalled()
  })

  test('opens create worktree for the current repo', async () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a'],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith('goblin+file:///tmp/repo-a', presentationOptions())
  })

  test('restores a saved new-worktree return target when navigating workspace history', () => {
    const navigation = routeNavigation()
    const target = {
      repoId: 'goblin+file:///tmp/repo-a',
      route: { kind: 'newWorktree' as const, returnTo: '/repo/repo-a/branch/main' },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a'],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack('goblin+file:///tmp/repo-a')

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith('goblin+file:///tmp/repo-a', 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-a',
      presentationOptions({ returnTo: '/repo/repo-a/branch/main' }),
    )
  })

  test('restores a saved bare branch workspace history entry', () => {
    const navigation = routeNavigation()
    const target = {
      repoId: 'goblin+file:///tmp/repo-a',
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: null,
        terminalWorktreeKey: null,
        terminalSessionId: null,
      },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a'],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack('goblin+file:///tmp/repo-a')

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith('goblin+file:///tmp/repo-a', 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-a',
      'feature/test',
      presentationOptions(),
    )
  })

  test.each(['back', 'forward'] as const)('restores a saved bare worktree history entry when navigating %s', (direction) => {
    const navigation = routeNavigation()
    const target: WorkspaceNavigationHistoryEntry = {
      repoId: REPO_ID,
      route: {
        kind: 'worktree',
        worktreePath: WORKTREE_PATH,
        workspacePaneTab: null,
        terminalSessionId: null,
      },
    }
    const traversal: WorkspaceNavigationHistoryTraversal = {
      repoId: REPO_ID,
      direction,
      current: { repoId: REPO_ID, route: { kind: 'dashboard' } },
      target,
    }
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    if (direction === 'back') actions.goBack(REPO_ID)
    else actions.goForward(REPO_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_ID, direction)
    expect(navigation.openRepoWorktree).toHaveBeenCalledWith(REPO_ID, WORKTREE_PATH, presentationOptions())
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
  })

  test('does not block bare branch history restore while tabs projection is pending', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const branch = {
      repoId: REPO_ID,
      route: {
        kind: 'branch',
        branchName: BRANCH_NAME,
        workspacePaneTab: null,
        terminalWorktreeKey: null,
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    const dashboard = {
      repoId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    useReposStore.getState().recordWorkspaceNavigation(branch)
    useReposStore.getState().recordWorkspaceNavigation(dashboard)
    const navigation = routeNavigation()
    const peekWorkspaceNavigation = vi.fn((repoId: string, direction: 'back' | 'forward') =>
      useReposStore.getState().peekWorkspaceNavigation(repoId, direction),
    )
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      order: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation: useReposStore.getState().commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_ID, 'back')
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, presentationOptions())
  })

  test('restores a malformed terminal history entry as the bare branch route', () => {
    const navigation = routeNavigation()
    const target = {
      repoId: 'goblin+file:///tmp/repo-a',
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: 'terminal' as const,
        terminalWorktreeKey: 'goblin+file:///tmp/repo-a\0goblin+file:///tmp/worktree',
        terminalSessionId: null,
      },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: 'goblin+file:///tmp/repo-a',
      order: ['goblin+file:///tmp/repo-a'],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack('goblin+file:///tmp/repo-a')

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith('goblin+file:///tmp/repo-a', 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(
      'goblin+file:///tmp/repo-a',
      'feature/test',
      presentationOptions(),
    )
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test.each(['back', 'forward'] as const)(
    'does not commit %s history when route restore is unavailable',
    (direction) => {
      const target = branchHistoryEntry('goblin+file:///tmp/repo-a', 'feature/test', 'history')
      const traversal = { ...historyTraversal(target), direction }
      const peekWorkspaceNavigation = vi.fn(() => traversal)
      const commitWorkspaceNavigation = vi.fn(() => true)
      const navigation = routeNavigation()
      vi.mocked(navigation.openRepoBranchTab).mockReturnValue(false)
      const actions = createPrimaryWindowNavigationActions({
        currentWorkspaceId: 'goblin+file:///tmp/repo-a',
        order: ['goblin+file:///tmp/repo-a'],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation: navigation,
      })

      if (direction === 'back') actions.goBack('goblin+file:///tmp/repo-a')
      else actions.goForward('goblin+file:///tmp/repo-a')

      expect(peekWorkspaceNavigation).toHaveBeenCalledWith('goblin+file:///tmp/repo-a', direction)
      expect(commitWorkspaceNavigation).not.toHaveBeenCalled()
    },
  )

  test('does not open create worktree without a current repo', () => {
    const navigation = routeNavigation()
    const actions = createPrimaryWindowNavigationActions({
      currentWorkspaceId: null,
      order: [],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })
})

function preferredWorkspacePaneTab() {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          BRANCH_NAME,
        ),
      )
    : null
}

function branchHistoryEntry(
  repoId: string,
  branchName: string,
  workspacePaneTab: 'status' | 'history',
): WorkspaceNavigationHistoryEntry {
  return {
    repoId,
    route: {
      kind: 'branch',
      branchName,
      workspacePaneTab,
      terminalWorktreeKey: null,
      terminalSessionId: null,
    },
  }
}

function historyTraversal(target: WorkspaceNavigationHistoryEntry): WorkspaceNavigationHistoryTraversal {
  return {
    repoId: target.repoId,
    direction: 'back',
    current: { repoId: target.repoId, route: { kind: 'dashboard' } },
    target,
  }
}

type PrimaryWindowNavigationActionOptions = Parameters<typeof createPrimaryWindowNavigationActionsCore>[0]
type PrimaryWindowNavigationActionTestOptions = Omit<
  PrimaryWindowNavigationActionOptions,
  'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'
> &
  Partial<Pick<PrimaryWindowNavigationActionOptions, 'peekWorkspaceNavigation' | 'commitWorkspaceNavigation'>>

function createPrimaryWindowNavigationActions(options: PrimaryWindowNavigationActionTestOptions) {
  const store = useReposStore.getState()
  return createPrimaryWindowNavigationActionsCore({
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    ...options,
  })
}

function markRepoGitUnavailable(repoId: string): void {
  useReposStore.setState((state) => {
    const repo = state.repos[repoId]
    if (!repo) return state
    return {
      repos: {
        ...state.repos,
        [repoId]: replaceRepo(repo, (draft) => {
          draft.workspaceProbe = {
          status: 'ready',
          name: 'workspace',
          capabilities: {
            files: { read: true, write: true },
            terminal: { available: true },
            git: { status: 'unavailable' },
          },
          diagnostics: [],
          }
        }),
      },
    }
  })
}

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    repoSlugForId: vi.fn(() => 'repo-slug'),
    currentWorkspacePaneRoute: () => undefined,
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openRepoRoot: vi.fn(),
    openRepoDashboard: vi.fn(),
    openWorkspaceRootPane: vi.fn((_repoId, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranch: vi.fn((_repoId, _branchName, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTab: vi.fn((_repoId, _branchName, _tab, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTerminal: vi.fn((_repoId, _branchName, _sessionId, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoWorktree: vi.fn((_repoId, _worktreePath, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}

function createPendingWorktreeSnapshot(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: true,
  }
}
