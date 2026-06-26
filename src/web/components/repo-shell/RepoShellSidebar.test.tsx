// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoShellSidebar } from '#/web/components/repo-shell/RepoShellSidebar.tsx'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

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

describe('RepoShellSidebar', () => {
  test('renders sidebar actions before the branch content without growing action rows', () => {
    render(<RepoShellSidebar repoId={REPO_ID} compact={false} branchContent={<div data-testid="branch-content" />} />)

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
    render(<RepoShellSidebar compact={false} />)

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
})

function render(node: ReactNode) {
  act(() => {
    root?.render(node)
  })
}
