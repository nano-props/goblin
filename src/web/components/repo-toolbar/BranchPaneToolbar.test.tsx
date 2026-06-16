// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchPaneToolbar } from '#/web/components/repo-toolbar/BranchPaneToolbar.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-branch-pane-toolbar-repo'

let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(max-width: 639px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  queryClient = null
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchPaneToolbar', () => {
  test('hides branch pager but keeps filter controls on small screens in non-focus mode', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })

    renderBar(navigationWith({}))

    expect(container?.textContent).not.toContain('2 / 3')
    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).toBeNull()

    const buttons = Array.from(container?.querySelectorAll('button') ?? [])
    const prevButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.prev-branch')
    const nextButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.next-branch')
    expect(prevButton).toBeUndefined()
    expect(nextButton).toBeUndefined()

    expect(container?.querySelector('[aria-label="branches.filter-label"]')).not.toBeNull()
  })

  test('hides branch pager on small screens with left-right layout', () => {
    useReposStore.setState({ workspaceLayout: 'left-right' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })

    renderBar(navigationWith({}))

    expect(container?.textContent).not.toContain('2 / 3')
    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).toBeNull()
  })
})

function renderBar(navigation: MainWindowNavigationActions) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  queryClient = new QueryClient()
  act(() => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <MainWindowNavigationProvider value={navigation}>
          <BranchPaneToolbar repoId={REPO_ID} />
        </MainWindowNavigationProvider>
      </QueryClientProvider>,
    )
  })
}

function navigationWith(overrides: Partial<MainWindowNavigationActions>): MainWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoDetailTab: () => {},
    showRepoBranchDetailTab: () => {},
    openSettings: () => {},
    ...overrides,
  }
}
