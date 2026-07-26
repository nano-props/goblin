// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceLayoutSkeleton } from '#/web/components/Skeleton.tsx'
import { STATUS_ROW_LAYOUT_CLASS } from '#/web/components/workspace-pane/status-ui.tsx'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after }: { before: React.ReactNode; after: React.ReactNode }) => (
    <div data-testid="mock-split-pane">
      {before}
      {after}
    </div>
  ),
}))

describe('WorkspaceLayoutSkeleton', () => {
  beforeEach(() => {
    responsiveMocks.compact = false
  })

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

    expect(container.querySelectorAll('li')).toHaveLength(6)
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
    expect(container.querySelectorAll('[data-testid="workspace-status-skeleton-row"]')).toHaveLength(8)
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

    expect(container.querySelectorAll('li')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="workspace-status-skeleton-row"]')).toHaveLength(8)
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

  test('uses two real-width workspace tab placeholders in default mode', () => {
    const { container } = renderInJsdom(
      <WorkspaceLayoutSkeleton singlePane singlePaneView="workspace" workspacePaneState="content" />,
    )

    const skeleton = container.querySelector('[data-testid="workspace-pane-skeleton"]')
    const tabs = container.querySelectorAll('[data-testid="workspace-pane-skeleton-tab"]')
    expect(skeleton?.getAttribute('aria-busy')).toBe('true')
    expect(tabs).toHaveLength(2)
    for (const tab of tabs) {
      expect(tab.className).toContain('h-7')
      expect(tab.className).toContain('w-36')
      expect(tab.className).toContain('shrink-0')
    }
    expect(container.querySelector('[data-testid="workspace-pane-skeleton-back"]')).toBeNull()
    expect(container.querySelector('[data-testid="workspace-pane-skeleton-switcher"]')).toBeNull()
  })

  test('matches compact workspace toolbar geometry', () => {
    responsiveMocks.compact = true
    const { container } = renderInJsdom(
      <WorkspaceLayoutSkeleton singlePane singlePaneView="workspace" workspacePaneState="content" />,
    )

    const toolbar = container.querySelector('.goblin-workspace-toolbar')
    const tabs = container.querySelectorAll('[data-testid="workspace-pane-skeleton-tab"]')
    expect(toolbar?.className).toContain('goblin-workspace-toolbar--non-draggable')
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.className).toContain('min-w-0')
    expect(tabs[0]?.className).toContain('flex-1')
    expect(container.querySelector('[data-testid="workspace-pane-skeleton-back"]')?.className).toContain('w-7')
    expect(container.querySelector('[data-testid="workspace-pane-skeleton-switcher"]')?.className).toContain('w-7')
  })

  test('uses the real Status row geometry for workspace content placeholders', () => {
    const { container } = renderInJsdom(
      <WorkspaceLayoutSkeleton singlePane singlePaneView="workspace" workspacePaneState="content" />,
    )

    const rows = container.querySelectorAll('[data-testid="workspace-status-skeleton-row"]')
    expect(rows).toHaveLength(8)
    for (const row of rows) expect(row.className).toBe(STATUS_ROW_LAYOUT_CLASS)
    expect(rows[0]?.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })
})
