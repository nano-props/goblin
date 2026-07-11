// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActionItems, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import type { BranchActionCapabilities } from '#/web/hooks/useBranchActions.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { idleOperation } from '#/web/stores/repos/operations.ts'

const mocks = vi.hoisted(() => ({
  setDetailCollapsed: vi.fn(),
  useBranchActions: vi.fn(),
  dispatchShowWorkspacePaneStaticTabAction: vi.fn(),
}))

vi.mock('#/web/hooks/useBranchActions.tsx', () => ({
  useBranchActions: mocks.useBranchActions,
}))

vi.mock('#/web/primary-window-navigation.tsx', () => ({
  usePrimaryWindowNavigation: () => ({
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

vi.mock('#/web/stores/repos/store.ts', () => ({
  useReposStore: (selector: (state: { setDetailCollapsed: typeof mocks.setDetailCollapsed }) => unknown) =>
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
    let actionIds: string[] = []

    await renderHookHost((actions) => {
      actionIds = visibleBranchActionItems(actions).map((item) => item.id)
    })

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
    let actions: ReturnType<typeof useBranchActionItems> | null = null

    await renderHookHost((nextActions) => {
      actions = nextActions
    })

    expect(actions!.copyPatchAction.visible).toBe(true)
    expect(actions!.copyPatchAction.label).toBe('status.copy-patch')
    expect(visibleBranchActionItems(actions!).map((item) => item.id)).not.toContain('copyPatch')
  })

  test('keeps branch-static tabs visible for a branch without a worktree but hides changes and files', async () => {
    let actionIds: string[] = []

    await renderHookHost(
      (actions) => {
        actionIds = visibleBranchActionItems(actions).map((item) => item.id)
      },
      { branch: { ...branch(), worktree: undefined } },
    )

    expect(actionIds).toContain('status')
    expect(actionIds).toContain('history')
    // Both `changes` and `files` are worktree-scoped tabs
    // (WORKSPACE_PANE_STATIC_TAB_SCOPES), so the menu items must
    // hide together when there is no worktree to walk.
    expect(actionIds).not.toContain('changes')
    expect(actionIds).not.toContain('files')
  })

  test('opens tab actions as generic append entries', async () => {
    let actions: ReturnType<typeof useBranchActionItems> | null = null

    await renderHookHost((nextActions) => {
      actions = nextActions
    })

    actions!.mainItems.find((item) => item.id === 'history')?.onSelect()

    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: '/tmp/goblin-action-items',
        branchName: 'feature/action-order',
        type: 'history',
        insertAfterIdentity: null,
      }),
    )
  })

  function renderHookHost(
    onReady: (actions: ReturnType<typeof useBranchActionItems>) => void,
    options: { branch?: RepoBranchState } = {},
  ) {
    return renderInJsdom(<HookHost onReady={onReady} branch={options.branch} />)
  }
})

function HookHost({
  onReady,
  branch: inputBranch,
}: {
  onReady: (actions: ReturnType<typeof useBranchActionItems>) => void
  branch?: RepoBranchState
}) {
  const branchActions = mocks.useBranchActions()
  onReady(useBranchActionItems(repo(), inputBranch ?? branch(), branchActions, { workspacePaneRoute: undefined }))
  return null
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

function repo(): BranchActionRepo {
  return {
    id: '/tmp/goblin-action-items',
    repoRuntimeId: 'repo-runtime-test',
    branchModel: {
      currentBranch: 'main',
      status: [],
      worktreesByPath: {},
    },
    branchAction: idleOperation(),
    remote: {
      lifecycle: null,
      hasRemotes: true,
      hasBrowserRemote: true,
      hasGitHubRemote: true,
      browserRemoteProvider: 'github',
      remoteProviders: { origin: 'github' },
    },
  }
}

function branch(): RepoBranchState {
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
    worktree: { path: '/tmp/goblin-action-items-worktree' },
  }
}
