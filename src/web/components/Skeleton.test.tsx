// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after }: { before: React.ReactNode; after: React.ReactNode }) => (
    <div data-testid="mock-split-pane">
      {before}
      {after}
    </div>
  ),
}))

describe('WorkspaceLayoutSkeleton', () => {
  test('shows branch rows and an empty workspace placeholder by default in split mode', () => {
    const { container } = renderInJsdom(<WorkspaceLayoutSkeleton />)

    expect(container.querySelectorAll('li')).toHaveLength(6)
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-skeleton-action"]')).toBeNull()
    // The current repo shell owns the sidebar chrome, so the
    // workspace skeleton no longer carries repo-level controls —
    // including the worktree-filter and layout-control slots.
    expect(container.querySelector('[data-testid="repo-toolbar-skeleton-branch-view"]')).toBeNull()
    expect(container.querySelector('[data-testid="repo-toolbar-skeleton-layout-control"]')).toBeNull()
    expect(container.querySelector('[data-testid="repo-toolbar-skeleton-pager"]')).toBeNull()
  })

  test('renders split workspace content when a repo workspace is selected', () => {
    const { container } = renderInJsdom(<WorkspaceLayoutSkeleton workspacePaneState="content" />)

    expect(container.querySelectorAll('li')).toHaveLength(14)
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container.querySelector('[data-testid="mock-split-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).toBeNull()
  })

  test('renders a single Branch Navigator skeleton in single-pane mode', () => {
    const { container } = renderInJsdom(<WorkspaceLayoutSkeleton singlePane />)

    expect(container.querySelectorAll('li')).toHaveLength(6)
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container.querySelector('[data-testid="mock-split-pane"]')).toBeNull()
  })

  test('renders a single Repo Workspace skeleton in selected single-pane mode', () => {
    const { container } = renderInJsdom(
      <WorkspaceLayoutSkeleton singlePane singlePaneView="workspace" workspacePaneState="content" />,
    )

    expect(container.querySelectorAll('li')).toHaveLength(8)
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="mock-split-pane"]')).toBeNull()
  })

  test('sizes branch action placeholders like the icon-only action button', () => {
    const { container } = renderInJsdom(<WorkspaceLayoutSkeleton singlePane />)

    const action = container.querySelector('[data-testid="branch-navigator-skeleton-action"] > div')
    expect(action?.className).toContain('h-6')
    expect(action?.className).toContain('w-7')
  })

  test('uses the same row metrics as the real Branch Navigator list', () => {
    const { container } = renderInJsdom(<WorkspaceLayoutSkeleton singlePane />)

    const row = container.querySelector('li')
    const content = row?.firstElementChild
    const actionSlot = row?.lastElementChild
    expect(row?.className).toContain('min-h-8')
    expect(row?.className).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(content?.className).toContain('px-3')
    expect(content?.className).toContain('py-1')
    expect(actionSlot?.className).toContain('pr-3')
  })
})
