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
  BranchWorkspace: () => <div data-testid="branch-workspace" />,
}))

vi.mock('#/web/components/Layout.tsx', () => ({
  RepoWorkspace: ({
    mode,
    branchNavigatorPane,
    branchWorkspacePane,
  }: {
    mode?: 'split' | 'single-pane'
    branchNavigatorPane: React.ReactNode
    branchWorkspacePane: React.ReactNode
  }) => (
    <div data-testid="repo-workspace" data-mode={mode ?? 'split'}>
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

  test('large-screen Focus Mode uses Branch Navigator until a branch opens Branch Workspace', () => {
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
    expect(branchNavigator()).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
  })

  test('compact branch activation opens Branch Workspace as the single pane', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(branchWorkspace()).toBeNull()

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
  })

  test('compact mode derives Branch Workspace from an existing selected branch', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    })

    expect(branchNavigator()).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
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

    expect(branchNavigator()).toBeNull()
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
