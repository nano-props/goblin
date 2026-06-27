// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after }: { before: React.ReactNode; after: React.ReactNode }) => (
    <div data-testid="mock-split-pane">
      {before}
      {after}
    </div>
  ),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoWorkspaceLayoutSkeleton', () => {
  test('shows branch rows and an empty workspace placeholder by default in split mode', () => {
    render(<RepoWorkspaceLayoutSkeleton />)

    expect(container?.querySelectorAll('li')).toHaveLength(6)
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container?.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="repo-workspace-skeleton"]')).toBeNull()
    expect(container?.querySelector('[data-testid="repo-workspace-skeleton-action"]')).toBeNull()
    // The active repo shell owns the sidebar chrome, so the
    // workspace skeleton no longer carries repo-level controls —
    // including the worktree-filter and layout-control slots.
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-branch-view"]')).toBeNull()
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-layout-control"]')).toBeNull()
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-pager"]')).toBeNull()
  })

  test('renders split workspace content when a branch workspace is selected', () => {
    render(<RepoWorkspaceLayoutSkeleton repoWorkspaceState="content" />)

    expect(container?.querySelectorAll('li')).toHaveLength(14)
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container?.querySelector('[data-testid="mock-split-pane"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="repo-workspace-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).toBeNull()
  })

  test('renders a single Branch Navigator skeleton in single-pane mode', () => {
    render(<RepoWorkspaceLayoutSkeleton singlePane />)

    expect(container?.querySelectorAll('li')).toHaveLength(6)
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container?.querySelector('[data-testid="mock-split-pane"]')).toBeNull()
  })

  test('renders a single Branch Workspace skeleton in selected single-pane mode', () => {
    render(<RepoWorkspaceLayoutSkeleton singlePane singlePaneView="workspace" repoWorkspaceState="content" />)

    expect(container?.querySelectorAll('li')).toHaveLength(8)
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
    expect(container?.querySelector('[data-testid="repo-workspace-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="mock-split-pane"]')).toBeNull()
  })

  test('sizes branch action placeholders like the icon-only action button', () => {
    render(<RepoWorkspaceLayoutSkeleton singlePane />)

    const action = container?.querySelector('[data-testid="branch-navigator-skeleton-action"] > div')
    expect(action?.className).toContain('h-6')
    expect(action?.className).toContain('w-7')
  })

  test('uses the same row metrics as the real Branch Navigator list', () => {
    render(<RepoWorkspaceLayoutSkeleton singlePane />)

    const row = container?.querySelector('li')
    const content = row?.firstElementChild
    const actionSlot = row?.lastElementChild
    expect(row?.className).toContain('min-h-8')
    expect(row?.className).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(content?.className).toContain('px-3')
    expect(content?.className).toContain('py-1')
    expect(actionSlot?.className).toContain('pr-3')
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}
