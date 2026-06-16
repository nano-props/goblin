// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchInfoBar } from '#/web/components/repo-toolbar/BranchInfoBar.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-branch-info-bar-repo'

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

describe('BranchInfoBar', () => {
  test('shows the selected branch summary beside the pager in focus mode', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [
        createRepoBranch('main'),
        createRepoBranch('feature/a', {
          ahead: 2,
          behind: 1,
          lastCommitAuthor: 'alice',
          lastCommitDate: '2026-06-07T10:00:00.000Z',
        }),
        createRepoBranch('feature/b'),
      ],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })
    useReposStore.setState({ workspaceLayout: 'top-bottom', detailCollapsed: false, detailFocusMode: true })

    renderBar(navigationWith({}))

    expect(container?.textContent).toContain('2 / 3')
    expect(container?.textContent).toContain('feature/a')
    expect(container?.textContent).toContain('2')
    expect(container?.textContent).toContain('1')
  })

  test('shows a branch dropdown in focus mode instead of prev/next buttons', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })
    useReposStore.setState({ workspaceLayout: 'top-bottom', detailCollapsed: false, detailFocusMode: true })

    renderBar(navigationWith({}))

    expect(container?.textContent).toContain('2 / 3')

    const buttons = Array.from(container?.querySelectorAll('button') ?? [])
    const prevButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.prev-branch')
    const nextButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.next-branch')
    expect(prevButton).toBeUndefined()
    expect(nextButton).toBeUndefined()

    const switchButton = buttons.find((button) => button.getAttribute('aria-label') === 'branches.switch')
    expect(switchButton).toBeInstanceOf(HTMLButtonElement)
  })

  test('always renders focus content regardless of workspace focus mode (caller decides when to mount)', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    useReposStore.setState({ workspaceLayout: 'top-bottom', detailCollapsed: false, detailFocusMode: false })

    renderBar(navigationWith({}))

    expect(container?.textContent).toContain('1 / 2')
  })

  test('renders nothing when the repo is not in the store (chrome exists guard)', () => {
    renderBar(navigationWith({}))

    expect(container?.textContent ?? '').toBe('')
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
          <BranchInfoBar repoId={REPO_ID} />
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
