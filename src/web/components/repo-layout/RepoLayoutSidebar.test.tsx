// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { fireEvent } from '@testing-library/react'
import { RepoLayoutSidebar } from '#/web/components/repo-layout/RepoLayoutSidebar.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'

vi.mock('#/web/components/RepoPickerHost.tsx', () => ({
  RepoPickerHost: () => <button type="button" data-testid="repo-picker-host" className="h-10 w-full shrink-0" />,
}))

const REPO_ID = '/tmp/repo-shell-sidebar-test'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
  })
})

afterEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  vi.restoreAllMocks()
})

describe('RepoLayoutSidebar', () => {
  test('renders sidebar actions before the branch content without growing action rows', () => {
    const { container } = renderSidebar(
      <RepoLayoutSidebar repoId={REPO_ID} compact={false} branchContent={<div data-testid="branch-content" />} />,
    )

    const sidebarTop = container.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()

    const repoPicker = container.querySelector('[data-testid="repo-picker-host"]')
    expect(repoPicker).not.toBeNull()

    const createWorktree = container.querySelector('[data-testid="create-worktree-button"]')
    if (!(createWorktree instanceof HTMLButtonElement)) throw new Error('missing create worktree button')
    expect(createWorktree.className).toContain('shrink-0')
    expect(createWorktree.className).not.toContain('flex-1')

    const branchTitle = [...container.querySelectorAll('div')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === 'tab.branches',
    )
    expect(branchTitle).not.toBeNull()
    expect(container.querySelector('[data-testid="branch-content"]')).not.toBeNull()

    const settings = container.querySelector('button[aria-label="app-chrome.settings"]')
    expect(settings).not.toBeNull()
  })

  test('renders placeholder state when no repo is open', () => {
    const { container } = renderSidebar(<RepoLayoutSidebar compact={false} />)

    expect(container.querySelector('[data-testid="repo-picker-host"]')).not.toBeNull()

    const createWorktree = container.querySelector('[data-testid="create-worktree-button"]')
    expect(createWorktree).toBeNull()

    const branchTitle = [...container.querySelectorAll('div')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === 'tab.branches',
    )
    expect(branchTitle).toBeUndefined()

    const settings = container.querySelector('button[aria-label="app-chrome.settings"]')
    expect(settings).not.toBeNull()
  })

  test('opens create-worktree from the row action', () => {
    const onCreateWorktree = vi.fn()
    const { container } = renderSidebar(
      <RepoLayoutSidebar
        repoId={REPO_ID}
        compact={false}
        branchContent={<div />}
        onCreateWorktree={onCreateWorktree}
      />,
    )

    const createWorktree = container.querySelector('[data-testid="create-worktree-button"]')
    if (!(createWorktree instanceof HTMLButtonElement)) throw new Error('missing create worktree button')

    fireEvent.click(createWorktree)

    expect(onCreateWorktree).toHaveBeenCalledTimes(1)
  })

  test('renders zen reveal top chrome as draggable without owning zen-toggle geometry', () => {
    const { container } = renderSidebar(
      <RepoLayoutSidebar repoId={REPO_ID} compact={false} branchContent={<div data-testid="branch-content" />} />,
    )

    const sidebarTop = container.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(sidebarTop?.className).toContain('title-bar-chrome')
    expect(sidebarTop?.className).not.toContain('relative')
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(sidebarTop?.hasAttribute('data-interactive')).toBe(false)
  })

  test('can render the top chrome as neutral when the docked sidebar is collapsed', () => {
    const { container } = renderSidebar(
      <RepoLayoutSidebar
        repoId={REPO_ID}
        compact={false}
        chromeRegion="none"
        branchContent={<div data-testid="branch-content" />}
      />,
    )

    const sidebarTop = container.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(sidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(sidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(sidebarTop?.hasAttribute('data-interactive')).toBe(false)
  })
})

function renderSidebar(element: ReactElement) {
  return renderInJsdom(<QueryClientProvider client={primaryWindowQueryClient}>{element}</QueryClientProvider>)
}
