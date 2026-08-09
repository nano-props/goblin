// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActionItems, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.tsx'
import type { BranchActionCapabilities } from '#/web/hooks/useBranchActions.tsx'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { idleOperation } from '#/web/stores/workspaces/operations.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'

const mocks = vi.hoisted(() => ({
  setDetailCollapsed: vi.fn(),
  useBranchActions: vi.fn(),
  dispatchShowWorkspacePaneStaticTabAction: vi.fn(),
}))

vi.mock('#/web/hooks/useBranchActions.tsx', () => ({
  useBranchActions: mocks.useBranchActions,
}))

vi.mock('#/web/app-navigation.tsx', () => ({
  useAppNavigation: () => ({
    showRepoBranchWorkspacePaneTab: vi.fn(),
  }),
}))

vi.mock('#/web/workspace-pane/workspace-pane-tab-open-action.ts', () => ({
  dispatchShowWorkspacePaneStaticTabAction: mocks.dispatchShowWorkspacePaneStaticTabAction,
}))

vi.mock('#/web/runtime-settings-external-apps.ts', () => ({
  useExternalAppSettings: () => ({
    terminalAvailable: true,
    editorAvailable: true,
  }),
}))

vi.mock('#/web/stores/workspaces/store.ts', () => ({
  workspacesStore: (selector: (state: { setDetailCollapsed: typeof mocks.setDetailCollapsed }) => unknown) =>
    selector({ setDetailCollapsed: mocks.setDetailCollapsed }),
}))

describe('useBranchActionItems', () => {
  beforeEach(() => {
    mocks.setDetailCollapsed.mockClear()
    mocks.dispatchShowWorkspacePaneStaticTabAction.mockClear()
    mocks.useBranchActions.mockReturnValue({
      blocked: false,
      busyAction: null,
      capabilities: allVisibleCapabilities(),
      actions: {
        pull: vi.fn(),
        push: vi.fn(),
        copyPatch: vi.fn(),
        openTerminal: vi.fn(),
        openEditor: vi.fn(),
        openFinder: vi.fn(),
        requestDeleteBranch: vi.fn(),
        requestRemoveWorktree: vi.fn(),
      },
    })
  })

  test('orders visible branch actions by high-frequency workflow before destructive actions', async () => {
    const { result } = renderBranchActionItems()
    const actionIds = visibleBranchActionItems(result.value.value).map((item) => item.id)

    expect(actionIds).toEqual([
      'pull',
      'push',
      'status',
      'changes',
      'files',
      'history',
      'removeWorktree',
      'deleteBranch',
    ])
  })

  test('exposes copy patch as a changes-tab action instead of a menu item', async () => {
    const { result } = renderBranchActionItems()

    expect(result.value.value.copyPatchAction.visible).toBe(true)
    expect(visibleBranchActionItems(result.value.value).map((item) => item.id)).not.toContain('copyPatch')
  })

  test('keeps branch-static tabs visible for a branch without a worktree but hides changes and files', async () => {
    const { result } = renderBranchActionItems({ branch: { ...branch(), worktree: undefined } })
    const actionIds = visibleBranchActionItems(result.value.value).map((item) => item.id)

    expect(actionIds).toContain('status')
    expect(actionIds).toContain('history')
    // Both `changes` and `files` are worktree-scoped tabs
    // (WORKSPACE_PANE_STATIC_TAB_SCOPES), so the menu items must
    // hide together when there is no worktree to walk.
    expect(actionIds).not.toContain('changes')
    expect(actionIds).not.toContain('files')
  })

  test('opens tab actions through destination navigation', async () => {
    const { result } = renderBranchActionItems()
    const historyAction = result.value.value.mainItems.find((item) => item.id === 'history')
    if (!historyAction) throw new Error('history action not rendered')
    historyAction.onSelect()

    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'goblin+file:///tmp/goblin-action-items',
        branchName: 'feature/action-order',
        type: 'history',
      }),
    )
  })

  function renderBranchActionItems(options: { branch?: BranchSnapshotInfo } = {}) {
    return renderComposableInJsdom(() => {
      const branchActions = mocks.useBranchActions()
      return useBranchActionItems(repo(), options.branch ?? branch(), branchActions, {
        workspacePaneRoute: undefined,
      })
    })
  }
})

function allVisibleCapabilities(): BranchActionCapabilities {
  // Ordering is cross-state UI policy, so this intentionally enables every
  // conditional action instead of modeling one real Git branch state.
  return {
    canRemoveWorktree: true,
    isRegularBranch: true,
    canCopyPatch: true,
    canPull: true,
    canPush: true,
    canOpenTerminal: true,
    canOpenEditor: true,
    canOpenFinder: true,
  }
}

function repo(): BranchActionRepo {
  return {
    id: workspaceIdForTest('goblin+file:///tmp/goblin-action-items'),
    workspaceRuntimeId: 'repo-runtime-test',
    snapshot: {
      current: 'main',
      branches: [],
      remote: {
        remotes: [],
        hasRemotes: true,
        hasBrowserRemote: true,
        hasGitHubRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github' },
      },
    },
    status: [],
    branchAction: idleOperation(),
    remoteLifecycle: null,
  }
}

function branch(): BranchSnapshotInfo {
  return {
    name: 'feature/action-order',
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitShortHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    tracking: 'origin/feature/action-order',
    worktree: { path: '/tmp/goblin-action-items-worktree', isPrimary: false, isLocked: false },
  }
}
