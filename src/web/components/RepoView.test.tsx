// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoView } from '#/web/components/RepoView.tsx'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))
const branchNavigatorMocks = vi.hoisted(() => ({
  activate: vi.fn<(repoId: string) => void>(),
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
}))

vi.mock('#/web/hooks/useRepoToasts.tsx', () => ({
  useRepoToasts: () => {},
}))

vi.mock('#/web/components/BranchNavigator.tsx', () => ({
  BranchNavigator: ({ repoId }: { repoId: string }) => (
    <button
      type="button"
      data-testid="branch-navigator"
      onClick={() => {
        branchNavigatorMocks.activate(repoId)
      }}
    >
      branch
    </button>
  ),
}))

vi.mock('#/web/components/BranchWorkspace.tsx', () => ({
  BranchWorkspace: ({
    presentedBranchName,
    shortcutsEnabled = true,
  }: {
    presentedBranchName?: string | null
    shortcutsEnabled?: boolean
  }) => (
    <div
      data-testid="branch-workspace"
      data-presented-branch-name={presentedBranchName ?? ''}
      data-shortcuts-enabled={shortcutsEnabled ? 'true' : 'false'}
    />
  ),
}))

vi.mock('#/web/components/Layout.tsx', () => ({
  RepoWorkspace: ({
    mode,
    branchNavigatorCollapsed,
    branchNavigatorPane,
    branchWorkspacePane,
  }: {
    mode?: 'split' | 'single-pane'
    branchNavigatorCollapsed?: boolean
    branchNavigatorPane: React.ReactNode
    branchWorkspacePane: React.ReactNode
  }) => (
    <div
      data-testid="repo-workspace"
      data-mode={mode ?? 'split'}
      data-branch-navigator-collapsed={branchNavigatorCollapsed ? 'true' : 'false'}
    >
      {mode === 'single-pane' ? (
        branchWorkspacePane
      ) : (
        <>
          {branchNavigatorPane}
          {branchWorkspacePane}
        </>
      )}
    </div>
  ),
  RepoWorkspacePane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Toolbar: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-toolbar">{children}</div>,
}))

const REPO_ID = '/tmp/repo-view-test'
let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  responsiveMocks.mode = 'default'
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
    selectedBranch: null,
  })
  branchNavigatorMocks.activate.mockImplementation((repoId) => {
    useReposStore.getState().selectBranch(repoId, 'feature/a')
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  branchNavigatorMocks.activate.mockReset()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoView workspace navigation', () => {
  test('large-screen branch activation keeps the Branch Navigator visible', () => {
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')
    expect(branchWorkspace()).not.toBeNull()
  })

  test('large-screen Focus Mode uses Branch Navigator until a branch opens a collapsed split workspace', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(branchNavigator()).not.toBeNull()
    expect(branchWorkspace()).toBeNull()
    expect(workspace()).toBeNull()

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')
    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(branchWorkspace()).not.toBeNull()
  })

  test('compact branch activation slides Branch Workspace into the active pane', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(compactWorkspace()?.dataset.activePane).toBe('navigator')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBe('true')

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
  })

  test('compact mode derives Branch Workspace from an existing selected branch', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    })

    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
  })

  test('compact back transition keeps the outgoing Branch Workspace content during slide-out', () => {
    vi.useFakeTimers()
    try {
      responsiveMocks.mode = 'compact'
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      })

      expect(branchWorkspace()?.dataset.presentedBranchName).toBe('feature/a')
      expect(branchWorkspace()?.dataset.shortcutsEnabled).toBe('true')

      act(() => {
        useReposStore.getState().clearSelectedBranch(REPO_ID)
      })

      expect(compactWorkspace()?.dataset.activePane).toBe('navigator')
      expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBe('true')
      expect(branchWorkspace()?.dataset.presentedBranchName).toBe('feature/a')
      expect(branchWorkspace()?.dataset.shortcutsEnabled).toBe('false')

      act(() => {
        vi.advanceTimersByTime(240)
      })

      expect(branchWorkspace()?.dataset.presentedBranchName).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  test('large-screen initial loading keeps the workspace pane empty when no branch is selected', () => {
    setSnapshotLoading(REPO_ID)
    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.mode).toBe('split')
    expect(container?.querySelector('[data-testid="branch-workspace-empty-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-skeleton"]')).toBeNull()
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
  })

  test('compact initial loading shows the selected Branch Workspace skeleton as the single pane', () => {
    responsiveMocks.mode = 'compact'
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    setSnapshotLoading(REPO_ID)

    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()).toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-empty-skeleton"]')).toBeNull()
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('resizing from split large-screen mode to compact shows Branch Workspace when a branch is selected', () => {
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(branchWorkspace()).not.toBeNull()

    act(() => {
      responsiveMocks.mode = 'compact'
      root!.render(<RepoView repoId={REPO_ID} />)
    })

    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function branchNavigator(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('[data-testid="branch-navigator"]') ?? null
}

function branchWorkspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="branch-workspace"]') ?? null
}

function workspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="repo-workspace"]') ?? null
}

function compactWorkspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-compact-workspace]') ?? null
}

function compactPane(pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`) ?? null
}

function setSnapshotLoading(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  useReposStore.setState({
    repos: {
      [repoId]: {
        ...repo,
        resources: {
          ...repo.resources,
          snapshot: {
            ...repo.resources.snapshot,
            phase: 'loading' as const,
            loadedAt: null,
            error: null,
            stale: false,
          },
        },
      },
    },
  })
}
