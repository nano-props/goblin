import { seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type {
  WorkspaceNavigationHistoryEntry,
  WorkspaceNavigationHistoryTraversal,
} from '#/web/stores/workspaces/types.ts'
import { currentAppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import {
  REPO_ID,
  REPO_A_ID,
  BRANCH_NAME,
  historyRestoreOptions,
  WORKTREE_PATH,
  setupAppNavigationActionsTests,
  branchHistoryEntry,
  historyTraversal,
  createAppNavigationActions,
  routeNavigation,
} from '#/web/app-navigation-actions.test-utils.ts'

beforeEach(setupAppNavigationActionsTests)

describe('createAppNavigationActions history traversal', () => {
  test.each(['back', 'forward'] as const)('moves %s history only after the restored route commits', (direction) => {
    const navigation = routeNavigation()
    let commitRoute: (() => void) | undefined
    vi.mocked(navigation.openRepoBranch).mockImplementation((_workspaceId, _branchName, options) => {
      commitRoute = options?.onCommit
      return true
    })
    const target: WorkspaceNavigationHistoryEntry = {
      workspaceId: REPO_A_ID,
      route: {
        kind: 'branch',
        branchName: 'feature/test',
        workspacePaneTab: null,
        terminalFilesystemTargetKey: null,
        terminalSessionId: null,
      },
    }
    const traversal = { ...historyTraversal(target), direction }
    const commitWorkspaceNavigation = vi.fn(() => true)
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_A_ID,
      workspaceOrder: [REPO_A_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation: vi.fn(() => traversal),
      commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    if (direction === 'back') actions.goBack(REPO_A_ID)
    else actions.goForward(REPO_A_ID)

    expect(commitWorkspaceNavigation).not.toHaveBeenCalled()
    expect(commitRoute).toBeTypeOf('function')

    commitRoute?.()

    expect(commitWorkspaceNavigation).toHaveBeenCalledOnce()
    expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
  })

  test.each(['back', 'forward'] as const)(
    'keeps navigation generation unchanged when %s has no target',
    (direction) => {
      seedRepoWithReadModelForTest({ id: REPO_A_ID, branches: [], currentBranchName: null })
      const navigation = routeNavigation()
      const peekWorkspaceNavigation = vi.fn(() => null)
      const actions = createAppNavigationActions({
        currentWorkspaceId: REPO_A_ID,
        workspaceOrder: [REPO_A_ID],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation: vi.fn(),
        routeNavigation: navigation,
      })
      const generationBefore = currentAppNavigationGeneration()

      if (direction === 'back') actions.goBack(REPO_A_ID)
      else actions.goForward(REPO_A_ID)

      expect(currentAppNavigationGeneration()).toBe(generationBefore)
      expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, direction)
    },
  )

  test.each(['back', 'forward'] as const)(
    'restores a saved bare worktree history entry when navigating %s',
    (direction) => {
      const navigation = routeNavigation()
      const target: WorkspaceNavigationHistoryEntry = {
        workspaceId: REPO_ID,
        route: {
          kind: 'worktree',
          worktreePath: WORKTREE_PATH,
          workspacePaneTab: null,
          terminalSessionId: null,
        },
      }
      const traversal: WorkspaceNavigationHistoryTraversal = {
        workspaceId: REPO_ID,
        direction,
        current: { workspaceId: REPO_ID, route: { kind: 'dashboard' } },
        target,
      }
      const peekWorkspaceNavigation = vi.fn(() => traversal)
      const commitWorkspaceNavigation = vi.fn(() => true)
      const actions = createAppNavigationActions({
        currentWorkspaceId: REPO_ID,
        workspaceOrder: [REPO_ID],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation: navigation,
      })

      if (direction === 'back') actions.goBack(REPO_ID)
      else actions.goForward(REPO_ID)

      expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_ID, direction)
      expect(navigation.openRepoWorktree).toHaveBeenCalledWith(REPO_ID, WORKTREE_PATH, historyRestoreOptions())
      expect(commitWorkspaceNavigation).toHaveBeenCalledWith(traversal)
    },
  )

  test('does not block bare branch history restore while tabs projection is pending', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranchName: BRANCH_NAME,
      preferredWorkspacePaneTab: 'status',
    })
    const branch = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch',
        branchName: BRANCH_NAME,
        workspacePaneTab: null,
        terminalFilesystemTargetKey: null,
        terminalSessionId: null,
      },
    } satisfies WorkspaceNavigationHistoryEntry
    const dashboard = {
      workspaceId: REPO_ID,
      route: { kind: 'dashboard' },
    } satisfies WorkspaceNavigationHistoryEntry
    workspacesStore.getState().recordWorkspaceNavigation(branch)
    workspacesStore.getState().recordWorkspaceNavigation(dashboard)
    const navigation = routeNavigation()
    const peekWorkspaceNavigation = vi.fn((workspaceId: WorkspaceId, direction: 'back' | 'forward') =>
      workspacesStore.getState().peekWorkspaceNavigation(workspaceId, direction),
    )
    const actions = createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation,
      commitWorkspaceNavigation: workspacesStore.getState().commitWorkspaceNavigation,
      routeNavigation: navigation,
    })

    actions.goBack(REPO_ID)

    expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_ID, 'back')
    expect(navigation.openRepoBranch).toHaveBeenCalledWith(REPO_ID, BRANCH_NAME, historyRestoreOptions())
  })

  test('restores a malformed terminal history entry as the bare branch route', () => {
    const navigation = routeNavigation()
    const target = {
      workspaceId: REPO_A_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/test',
        workspacePaneTab: 'terminal' as const,
        terminalFilesystemTargetKey: 'goblin+file:///tmp/repo-a\0goblin+file:///tmp/worktree',
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
    expect(navigation.openRepoBranchTab).not.toHaveBeenCalled()
    expect(navigation.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test.each(['back', 'forward'] as const)(
    'does not commit %s history or advance navigation when route restore is unavailable',
    (direction) => {
      const target = branchHistoryEntry(REPO_A_ID, 'feature/test', 'history')
      const traversal = { ...historyTraversal(target), direction }
      const peekWorkspaceNavigation = vi.fn(() => traversal)
      const commitWorkspaceNavigation = vi.fn(() => true)
      const navigation = routeNavigation()
      vi.mocked(navigation.openRepoBranchTab).mockReturnValue(false)
      const actions = createAppNavigationActions({
        currentWorkspaceId: REPO_A_ID,
        workspaceOrder: [REPO_A_ID],
        closeWorkspace: vi.fn(),
        peekWorkspaceNavigation,
        commitWorkspaceNavigation,
        routeNavigation: navigation,
      })
      const generationBefore = currentAppNavigationGeneration()

      if (direction === 'back') actions.goBack(REPO_A_ID)
      else actions.goForward(REPO_A_ID)

      expect(peekWorkspaceNavigation).toHaveBeenCalledWith(REPO_A_ID, direction)
      expect(commitWorkspaceNavigation).not.toHaveBeenCalled()
      expect(currentAppNavigationGeneration()).toBe(generationBefore)
    },
  )

  test('does not open create worktree without a current repo', () => {
    const navigation = routeNavigation()
    const actions = createAppNavigationActions({
      currentWorkspaceId: null,
      workspaceOrder: [],
      closeWorkspace: vi.fn(),
      routeNavigation: navigation,
    })

    actions.openCreateWorktree()

    expect(navigation.openRepoNewWorktree).not.toHaveBeenCalled()
  })
})
