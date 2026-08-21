// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActionItems, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.tsx'
import type { BranchActionCapabilities, BranchActions } from '#/web/hooks/useBranchActions.tsx'
import type { BranchSnapshotInfo } from '#/shared/git-types.ts'
import { idleOperation } from '#/web/stores/workspaces/operations.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { renderComposableInJsdom } from '#/test-utils/render.tsx'

const mocks = vi.hoisted(() => ({
  dispatchShowWorkspacePaneStaticTabAction: vi.fn(),
}))

vi.mock('#/web/app/navigation/context.tsx', () => ({
  useAppNavigation: () => ({
    showRepoBranchWorkspacePaneTab: vi.fn(),
  }),
}))

vi.mock('#/web/workspace-pane/workspace-pane-tab-open-action.ts', () => ({
  dispatchShowWorkspacePaneStaticTabAction: mocks.dispatchShowWorkspacePaneStaticTabAction,
}))

describe('useBranchActionItems', () => {
  beforeEach(() => {
    mocks.dispatchShowWorkspacePaneStaticTabAction.mockClear()
  })

  test('orders visible branch actions by high-frequency workflow before destructive actions', () => {
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

  test('exposes copy patch as a changes-tab action instead of a menu item', () => {
    const { result } = renderBranchActionItems()

    expect(result.value.value.copyPatchAction.visible).toBe(true)
    expect(visibleBranchActionItems(result.value.value).map((item) => item.id)).not.toContain('copyPatch')
  })

  test('keeps branch-static tabs visible for a branch without a worktree but hides changes and files', () => {
    const { result } = renderBranchActionItems({ withWorktree: false })
    const actionIds = visibleBranchActionItems(result.value.value).map((item) => item.id)

    expect(actionIds).toContain('status')
    expect(actionIds).toContain('history')
    // Both `changes` and `files` are worktree-scoped tabs
    // (WORKSPACE_PANE_STATIC_TAB_SCOPES), so the menu items must
    // hide together when there is no worktree to walk.
    expect(actionIds).not.toContain('changes')
    expect(actionIds).not.toContain('files')
  })

  test('opens tab actions through destination navigation', () => {
    const { result } = renderBranchActionItems()
    const historyAction = result.value.value.mainItems.find((item) => item.id === 'history')
    if (!historyAction) throw new Error('history action not rendered')
    historyAction.onSelect()

    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'goblin+file:///tmp/goblin-action-items',
        workspaceRuntimeId: 'repo-runtime-test',
        branchName: 'feature/action-order',
        type: 'history',
      }),
    )
  })

  function renderBranchActionItems(options: { withWorktree?: boolean } = {}) {
    return renderComposableInJsdom(() => {
      const selectedBranch = branch()
      return useBranchActionItems(repo(selectedBranch, options.withWorktree ?? true), selectedBranch, branchActions(), {
        workspacePaneRoute: undefined,
      })
    })
  }
})

function branchActions(): BranchActions {
  return {
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
  }
}

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

function repo(branch: BranchSnapshotInfo, withWorktree: boolean): BranchActionRepo {
  return {
    id: workspaceIdForTest('goblin+file:///tmp/goblin-action-items'),
    workspaceRuntimeId: 'repo-runtime-test',
    snapshot: {
      current: 'main',
      branches: [],
      worktrees: withWorktree
        ? [
            {
              path: '/tmp/goblin-action-items-worktree',
              head: { kind: 'branch', branchName: branch.name },
              headOid: 'a'.repeat(40),
              operation: null,
              materializedBranch: branch.name,
              isPrimary: false,
              isSource: false,
              isLocked: false,
            },
          ]
        : [],
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
    ahead: 0,
    behind: 0,
    lastCommitHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    lastCommitShortHash: 'aaaaaaa',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    tracking: 'origin/feature/action-order',
  }
}
