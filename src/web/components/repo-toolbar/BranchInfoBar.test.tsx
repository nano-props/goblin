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
  test('renders the selected branch summary with the branch name as the dropdown trigger in focus mode', () => {
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
    useReposStore.setState({ workspacePaneFocusMode: true })

    renderBar(navigationWith({}))

    // The pager counter ("1 / N") is gone — the dropdown trigger now IS
    // the branch name + chevron. The ahead/behind deltas and commit
    // meta continue to render in the read-only meta strip.
    expect(container?.textContent).not.toContain('2 / 3')
    expect(container?.textContent).toContain('feature/a')
    expect(container?.textContent).toContain('2')
    expect(container?.textContent).toContain('1')

    const trigger = container?.querySelector('button[aria-label="branches.switch"]')
    expect(trigger).toBeInstanceOf(HTMLButtonElement)
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger?.textContent).toContain('feature/a')
    // Chevron is rendered as an SVG inside the trigger.
    expect(trigger?.querySelector('svg')).not.toBeNull()
  })

  test('does not render prev/next pager buttons in focus mode', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })
    useReposStore.setState({ workspacePaneFocusMode: true })

    renderBar(navigationWith({}))

    const buttons = Array.from(container?.querySelectorAll('button') ?? [])
    const prevButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.prev-branch')
    const nextButton = buttons.find((button) => button.getAttribute('aria-label') === 'help.row.next-branch')
    expect(prevButton).toBeUndefined()
    expect(nextButton).toBeUndefined()

    const switchButton = buttons.find((button) => button.getAttribute('aria-label') === 'branches.switch')
    expect(switchButton).toBeInstanceOf(HTMLButtonElement)
  })

  test('opens the branch list dropdown when the trigger is activated', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranch: 'main',
      selectedBranch: 'feature/a',
    })
    useReposStore.setState({ workspacePaneFocusMode: true })

    renderBar(navigationWith({}))

    const trigger = container?.querySelector<HTMLButtonElement>('button[aria-label="branches.switch"]')
    expect(trigger).toBeInstanceOf(HTMLButtonElement)

    // Radix's DropdownMenu opens on `pointerdown` rather than `click`,
    // so a bare .click() in jsdom leaves the menu closed.
    act(() => {
      trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))
      trigger?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }))
      trigger?.click()
    })

    // The menu mounts into a Radix portal; query the document instead
    // of the test container.
    const menu = document.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? [])
    const labels = items.map((item) => item.textContent?.trim() ?? '')
    expect(labels).toEqual(expect.arrayContaining(['main', 'feature/a', 'feature/b']))
  })

  test('always renders focus content regardless of workspace focus mode (caller decides when to mount)', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    useReposStore.setState({ workspacePaneFocusMode: false })

    renderBar(navigationWith({}))

    expect(container?.textContent).not.toContain('1 / 2')
    expect(container?.textContent).toContain('main')
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
    showRepoWorkspacePaneView: () => {},
    showRepoBranchWorkspacePaneView: () => {},
    openSettings: () => {},
    ...overrides,
  }
}
