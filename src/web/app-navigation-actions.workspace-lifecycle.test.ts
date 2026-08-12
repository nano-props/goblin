import { seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  REPO_ID,
  REPO_A_ID,
  REPO_B_ID,
  REPO_C_ID,
  BRANCH_NAME,
  presentationOptions,
  historyRestoreOptions,
  WORKTREE_PATH,
  setupAppNavigationActionsTests,
  branchHistoryEntry,
  historyTraversal,
  createAppNavigationActions,
  routeNavigation,
  createPendingWorktreeSnapshot,
} from '#/web/app-navigation-actions.test-utils.ts'

beforeEach(setupAppNavigationActionsTests)

describe('createAppNavigationActions workspace lifecycle', () => {
  test('cycles repos by navigating from the current repo', () => {
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(1)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_B_ID, presentationOptions())
  })

  test('activates a repo at its current workspace history entry', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_B_ID,
      branches: [createRepoBranch('feature/remembered')],
      currentBranchName: 'feature/remembered',
    })
    const entry = branchHistoryEntry(REPO_B_ID, 'feature/remembered', 'history')
    workspacesStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_B_ID)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_B_ID,
      'feature/remembered',
      'history',
      presentationOptions(),
    )
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
  })

  test('does not resume a repo at its new-worktree workflow', async () => {
    workspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: REPO_B_ID,
      route: { kind: 'newWorktree', returnTo: '/workspace/repo-b/branch/main' },
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_B_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_B_ID, presentationOptions())
    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })

  test('does not replace a blocked repo history restore with the dashboard', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const entry = branchHistoryEntry(REPO_ID, BRANCH_NAME, 'status')
    workspacesStore.getState().recordWorkspaceNavigation(entry)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_ID)

    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(entry)
  })

  test('falls back to the dashboard when a repo history route is unavailable', async () => {
    const entry = branchHistoryEntry(REPO_B_ID, 'feature/remembered', 'history')
    workspacesStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    vi.mocked(navigation.openRepoBranchTab).mockReturnValue(false)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(REPO_B_ID)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_B_ID, presentationOptions())
  })

  test('falls back to the dashboard when workspace-root history cannot be presented', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/workspace-b')
    const currentWorkspaceId = workspaceIdForTest('goblin+file:///tmp/workspace-a')
    workspacesStore.getState().recordWorkspaceNavigation({
      workspaceId: workspaceId,
      route: { kind: 'workspace-root', workspacePaneTab: null, terminalSessionId: null },
    })
    const navigation = routeNavigation()
    vi.mocked(navigation.openWorkspaceRootPane).mockReturnValue(false)
    const actions = createAppNavigationActions({
      currentWorkspaceId,
      workspaceOrder: [currentWorkspaceId, workspaceId],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.activateWorkspace(workspaceId)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(workspaceId, presentationOptions())
  })

  test('cycles to the target repo current workspace history entry', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_B_ID,
      branches: [createRepoBranch('feature/remembered')],
      currentBranchName: 'feature/remembered',
    })
    const entry = branchHistoryEntry(REPO_B_ID, 'feature/remembered', 'status')
    workspacesStore.getState().recordWorkspaceNavigation(entry)
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(1)

    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_B_ID,
      'feature/remembered',
      'status',
      presentationOptions(),
    )
  })

  test('cycles repos backward and wraps around', () => {
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.cycleWorkspace(-1)

    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_C_ID, presentationOptions())
  })

  test('closes the repo through the store action without navigation when it is not current', async () => {
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_B_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_B_ID)
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
  })

  test('closes the current repo and navigates to the next repo dashboard without history', async () => {
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_B_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_B_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_B_ID)
    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_C_ID, presentationOptions())
  })

  test('closes the current repo and restores the next repo workspace history entry', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_C_ID,
      branches: [createRepoBranch('feature/remembered')],
      currentBranchName: 'feature/remembered',
    })
    workspacesStore.getState().recordWorkspaceNavigation(branchHistoryEntry(REPO_C_ID, 'feature/remembered', 'history'))
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_B_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID, REPO_C_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_B_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_B_ID)
    expect(navigation.openRepoBranchTab).toHaveBeenCalledWith(
      REPO_C_ID,
      'feature/remembered',
      'history',
      presentationOptions(),
    )
  })

  test('closes the current repo into the next repo dashboard when its history restore is blocked', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const entry = branchHistoryEntry(REPO_ID, BRANCH_NAME, 'status')
    workspacesStore.getState().recordWorkspaceNavigation(entry)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => createPendingWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      createTerminalWithAdmission: vi.fn(async () => {
        throw new Error('unexpected terminal creation')
      }),
      selectTerminal: vi.fn(),
      focusTerminal: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'not-committed' as const, message: null })),
    })
    const closeWorkspace = vi.fn(async () => ({ ok: true as const }))
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_ID],
      closeWorkspace,
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_A_ID)

    expect(closeWorkspace).toHaveBeenCalledWith(REPO_A_ID)
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID, presentationOptions())
    expect(workspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(entry)
  })

  test('closes the final current repo and navigates home', async () => {
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(async () => ({ ok: true as const })),
      routeNavigation: navigation,
    })

    await actions.closeWorkspace(REPO_A_ID)

    expect(navigation.openHome).toHaveBeenCalled()
  })

  test('keeps the current route when the shared workspace close fails', async () => {
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID, REPO_B_ID],
      closeWorkspace: vi.fn(async () => ({
        ok: false as const,
        kind: 'failed' as const,
        message: 'error.failed-read-repo',
      })),
      routeNavigation: navigation,
    })

    await expect(actions.closeWorkspace(REPO_A_ID)).resolves.toEqual({
      ok: false,
      kind: 'failed',
      message: 'error.failed-read-repo',
    })
    expect(navigation.openWorkspaceDashboard).not.toHaveBeenCalled()
    expect(navigation.openHome).not.toHaveBeenCalled()
  })

  test('opens create worktree for the current repo', async () => {
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith(REPO_A_ID, presentationOptions())
  })

  test('restores a saved new-worktree return target when navigating workspace history', () => {
    const navigation = routeNavigation()
    const target = {
      workspaceId: REPO_A_ID,
      route: { kind: 'newWorktree' as const, returnTo: '/workspace/repo-a/branch/main' },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_A_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoNewWorktree).toHaveBeenCalledWith(
      REPO_A_ID,
      historyRestoreOptions({ returnTo: '/workspace/repo-a/branch/main' }),
    )
  })

  test('restores a saved bare branch workspace history entry', () => {
    const navigation = routeNavigation()
    const target = {
      workspaceId: REPO_A_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: null,
        terminalFilesystemTargetKey: null,
        terminalSessionId: null,
      },
    }
    const traversal = historyTraversal(target)
    const peekWorkspaceNavigation = vi.fn(() => traversal)
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_A_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, 'back')
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_A_ID, 'feature/test', historyRestoreOptions())
  })
})
