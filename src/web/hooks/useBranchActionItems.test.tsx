// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { BranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActionItems, visibleBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import type { BranchActionCapabilities } from '#/web/hooks/useBranchActions.tsx'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import { idleOperation } from '#/web/stores/repos/operations.ts'

const mocks = vi.hoisted(() => ({
  setDetailCollapsed: vi.fn(),
  useBranchActions: vi.fn(),
}))

vi.mock('#/web/hooks/useBranchActions.tsx', () => ({
  useBranchActions: mocks.useBranchActions,
}))

vi.mock('#/web/main-window-navigation.tsx', () => ({
  useMainWindowNavigation: () => ({
    showRepoBranchWorkspacePaneView: vi.fn(),
  }),
}))

vi.mock('#/web/runtime-settings-external-apps.ts', () => ({
  useRuntimeExternalAppSettings: () => ({
    terminalApp: 'auto',
    resolvedTerminalApp: 'terminal',
    terminalAvailable: true,
    editorApp: 'auto',
    resolvedEditorApp: 'vscode',
    editorAvailable: true,
  }),
}))

vi.mock('#/web/stores/repos/store.ts', () => ({
  useReposStore: (selector: (state: { setDetailCollapsed: typeof mocks.setDetailCollapsed }) => unknown) =>
    selector({ setDetailCollapsed: mocks.setDetailCollapsed }),
}))

describe('useBranchActionItems', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.setDetailCollapsed.mockClear()
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
        openRemote: vi.fn(),
        requestDeleteBranch: vi.fn(),
        requestRemoveWorktree: vi.fn(),
      },
      dialogs: null,
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    root = null
    container = null
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  test('orders visible branch actions by primary workflow before destructive actions', async () => {
    let actionIds: string[] = []

    await renderHookHost((actions) => {
      actionIds = visibleBranchActionItems(actions).map((item) => item.id)
    })

    expect(actionIds).toEqual([
      'status',
      'changes',
      'pull',
      'push',
      'copyPatch',
      'terminal',
      'editor',
      'remote',
      'removeWorktree',
      'deleteBranch',
    ])
  })

  test('keeps status visible for a branch without a worktree but hides changes', async () => {
    let actionIds: string[] = []

    await renderHookHost(
      (actions) => {
        actionIds = visibleBranchActionItems(actions).map((item) => item.id)
      },
      { branch: { ...branch(), worktree: undefined } },
    )

    expect(actionIds).toContain('status')
    expect(actionIds).not.toContain('changes')
  })

  async function renderHookHost(
    onReady: (actions: ReturnType<typeof useBranchActionItems>) => void,
    options: { branch?: RepoBranchState } = {},
  ) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root!.render(<HookHost onReady={onReady} branch={options.branch} />)
      await Promise.resolve()
    })
  }
})

function HookHost({
  onReady,
  branch: inputBranch,
}: {
  onReady: (actions: ReturnType<typeof useBranchActionItems>) => void
  branch?: RepoBranchState
}) {
  onReady(useBranchActionItems(repo(), inputBranch ?? branch()))
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
    canOpenRemote: true,
    canOpenTerminal: true,
    canOpenEditor: true,
  }
}

function repo(): BranchActionRepo {
  return {
    id: '/tmp/gbl-action-items',
    instanceToken: 1,
    data: {
      currentBranch: 'main',
      status: [],
      worktreesByPath: {},
    },
    operations: {
      branchAction: idleOperation(),
    },
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
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    tracking: 'origin/feature/action-order',
    worktree: { path: '/tmp/gbl-action-items-worktree' },
  }
}
