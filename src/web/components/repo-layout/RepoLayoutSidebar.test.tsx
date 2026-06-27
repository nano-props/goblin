// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoLayoutSidebar } from '#/web/components/repo-layout/RepoLayoutSidebar.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'

vi.mock('#/web/components/RepoPickerHost.tsx', () => ({
  RepoPickerHost: () => <button type="button" data-testid="repo-picker-host" className="h-10 w-full shrink-0" />,
}))

const REPO_ID = '/tmp/repo-shell-sidebar-test'
let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
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
  resetReposStore()
  vi.restoreAllMocks()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoLayoutSidebar', () => {
  test('renders sidebar actions before the branch content without growing action rows', () => {
    render(<RepoLayoutSidebar repoId={REPO_ID} compact={false} branchContent={<div data-testid="branch-content" />} />)

    const sidebarTop = document.body.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()

    const repoPicker = document.body.querySelector('[data-testid="repo-picker-host"]')
    expect(repoPicker).not.toBeNull()

    const createWorktree = document.body.querySelector('[data-testid="create-worktree-button"]')
    if (!(createWorktree instanceof HTMLButtonElement)) throw new Error('missing create worktree button')
    expect(createWorktree.className).toContain('shrink-0')
    expect(createWorktree.className).not.toContain('flex-1')

    const branchTitle = [...document.body.querySelectorAll('div')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === 'tab.branches',
    )
    expect(branchTitle).not.toBeNull()
    expect(document.body.querySelector('[data-testid="branch-content"]')).not.toBeNull()

    const settings = document.body.querySelector('button[aria-label="app-chrome.settings"]')
    expect(settings).not.toBeNull()
  })

  test('renders placeholder state when no repo is open', () => {
    render(<RepoLayoutSidebar compact={false} />)

    expect(document.body.querySelector('[data-testid="repo-picker-host"]')).not.toBeNull()

    const createWorktree = document.body.querySelector('[data-testid="create-worktree-button"]')
    expect(createWorktree).toBeNull()

    const branchTitle = [...document.body.querySelectorAll('div')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === 'tab.branches',
    )
    expect(branchTitle).toBeUndefined()

    const settings = document.body.querySelector('button[aria-label="app-chrome.settings"]')
    expect(settings).not.toBeNull()
  })

  test('renders zen reveal top chrome as draggable without owning zen-toggle geometry', () => {
    render(<RepoLayoutSidebar repoId={REPO_ID} compact={false} branchContent={<div data-testid="branch-content" />} />)

    const sidebarTop = document.body.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(sidebarTop?.className).toContain('title-bar-chrome')
    expect(sidebarTop?.className).not.toContain('relative')
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(sidebarTop?.hasAttribute('data-interactive')).toBe(false)
  })

  test('can render the top chrome as neutral when the docked sidebar is collapsed', () => {
    render(
      <RepoLayoutSidebar
        repoId={REPO_ID}
        compact={false}
        chromeRegion="none"
        branchContent={<div data-testid="branch-content" />}
      />,
    )

    const sidebarTop = document.body.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(sidebarTop?.hasAttribute('data-interactive')).toBe(false)
  })
})

function render(node: ReactNode) {
  act(() => {
    root?.render(node)
  })
}
