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
const branchListMocks = vi.hoisted(() => ({
  activate: vi.fn<(repoId: string) => void>(),
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
}))

vi.mock('#/web/hooks/useRepoToasts.tsx', () => ({
  useRepoToasts: () => {},
}))

vi.mock('#/web/components/BranchList.tsx', () => ({
  BranchList: ({
    repoId,
    onBranchActivated,
  }: {
    repoId: string
    onBranchActivated?: () => void
  }) => (
    <button
      type="button"
      data-testid="branch-list"
      onClick={() => {
        branchListMocks.activate(repoId)
        onBranchActivated?.()
      }}
    >
      branch
    </button>
  ),
}))

vi.mock('#/web/components/BranchDetail.tsx', () => ({
  BranchDetail: ({ onBack }: { onBack?: () => void }) => (
    <div data-testid="branch-detail" data-has-back={String(!!onBack)}>
      {onBack && (
        <button type="button" data-testid="workspace-back" onClick={onBack}>
          back
        </button>
      )}
    </div>
  ),
}))

vi.mock('#/web/components/Layout.tsx', () => ({
  RepoWorkspace: ({
    mode,
    branchPane,
    workspacePane,
  }: {
    mode?: 'split' | 'workspace-only'
    branchPane: React.ReactNode
    workspacePane: React.ReactNode
  }) => (
    <div data-testid="repo-workspace" data-mode={mode ?? 'split'}>
      {mode === 'workspace-only' ? workspacePane : (
        <>
          {branchPane}
          {workspacePane}
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
  branchListMocks.activate.mockImplementation((repoId) => {
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
  branchListMocks.activate.mockReset()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoView workspace navigation', () => {
  test('large-screen branch activation enters workspace-only mode and back returns without list selection', () => {
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')

    act(() => {
      branchList()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchList()).toBeNull()
    expect(workspace()?.dataset.mode).toBe('workspace-only')
    expect(branchDetail()?.dataset.hasBack).toBe('true')

    act(() => {
      backButton()?.click()
    })

    expect(workspace()?.dataset.mode).toBe('split')
    expect(branchList()).not.toBeNull()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
  })

  test('compact branch activation and back keep Branch View unselected', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(branchDetail()).toBeNull()

    act(() => {
      branchList()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchList()).toBeNull()
    expect(branchDetail()?.dataset.hasBack).toBe('true')

    act(() => {
      backButton()?.click()
    })

    expect(branchList()).not.toBeNull()
    expect(branchDetail()).toBeNull()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function branchList(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('[data-testid="branch-list"]') ?? null
}

function branchDetail(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="branch-detail"]') ?? null
}

function backButton(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('[data-testid="workspace-back"]') ?? null
}

function workspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="repo-workspace"]') ?? null
}
