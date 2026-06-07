// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoToolbar } from '#/web/components/repo-toolbar/RepoToolbar.tsx'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-repo-toolbar-repo'

let container: HTMLDivElement | null = null
let root: Root | null = null
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
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoToolbar', () => {
  test('shows the selected branch summary beside the pager in focus mode', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [
        createRepoBranch('main'),
        createRepoBranch('feature/a', { ahead: 2, behind: 1, lastCommitAuthor: 'alice', lastCommitDate: '2026-06-07T10:00:00.000Z' }),
        createRepoBranch('feature/b'),
      ],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })
    useReposStore.setState({ workspaceLayout: 'top-bottom', detailCollapsed: false, detailFocusMode: true })

    renderToolbar(navigationWith({}))

    expect(container?.textContent).toContain('2 / 3')
    expect(container?.textContent).toContain('feature/a')
    expect(container?.textContent).toContain('2')
    expect(container?.textContent).toContain('1')
  })

  test('shows branch pager on small screens instead of filter and search', () => {
    const selectRepoBranch = vi.fn()
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })

    renderToolbar(navigationWith({ selectRepoBranch }))

    expect(container?.textContent).toContain('2 / 3')
    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).toBeNull()

    const buttons = Array.from(container?.querySelectorAll('button') ?? [])
    const prevButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.prev-branch')
    const nextButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.next-branch')
    if (!(prevButton instanceof HTMLButtonElement) || !(nextButton instanceof HTMLButtonElement)) {
      throw new Error('missing branch pager buttons')
    }

    act(() => {
      prevButton.click()
      nextButton.click()
    })

    expect(selectRepoBranch).toHaveBeenNthCalledWith(1, REPO_ID, 'main')
    expect(selectRepoBranch).toHaveBeenNthCalledWith(2, REPO_ID, 'feature/b')
  })

  test('keeps compact branch pager behavior when left-right layout is downgraded on small screens', () => {
    useReposStore.setState({ workspaceLayout: 'left-right' })
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })

    renderToolbar(navigationWith({}))

    expect(container?.textContent).toContain('2 / 3')
    expect(container?.querySelector('[aria-label="workspace.layout-label"]')).toBeNull()
  })
})

function renderToolbar(navigation: MainWindowNavigationActions) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <MainWindowNavigationProvider value={navigation}>
        <RepoToolbar repoId={REPO_ID} />
      </MainWindowNavigationProvider>,
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
