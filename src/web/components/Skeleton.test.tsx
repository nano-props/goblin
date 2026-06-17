// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'

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

describe('RepoWorkspaceSkeleton', () => {
  test('shows compact branch rows with list actions in top-bottom split mode', () => {
    render(<RepoWorkspaceSkeleton layout="top-bottom" detailCollapsed={false} detailFocusMode={false} />)

    expect(container?.querySelectorAll('li')).toHaveLength(14)
    expect(container?.querySelectorAll('[data-testid="branch-list-skeleton-action"]')).toHaveLength(6)
    expect(container?.querySelector('[data-testid="branch-detail-skeleton-action"]')).toBeNull()
    // The per-repo toolbar moved up to the Topbar, so the
    // workspace skeleton no longer carries its own toolbar —
    // including the worktree-filter and layout-control slots.
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-branch-view"]')).toBeNull()
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-layout-control"]')).toBeNull()
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-pager"]')).toBeNull()
  })

  test('renders split workspace with list actions in left-right mode', () => {
    render(<RepoWorkspaceSkeleton layout="left-right" detailCollapsed={false} detailFocusMode={false} />)

    expect(container?.querySelectorAll('li')).toHaveLength(14)
    expect(container?.querySelectorAll('[data-testid="branch-list-skeleton-action"]')).toHaveLength(6)
    expect(container?.querySelector('[data-testid="mock-split-pane"]')).not.toBeNull()
  })

  test('hides the branch pane entirely in top-bottom focus mode', () => {
    render(<RepoWorkspaceSkeleton layout="top-bottom" detailCollapsed={false} detailFocusMode />)

    expect(container?.querySelectorAll('li')).toHaveLength(8)
    expect(container?.querySelectorAll('[data-testid="branch-list-skeleton-action"]')).toHaveLength(0)
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-pager"]')).toBeNull()
    expect(container?.querySelector('[data-testid="repo-toolbar-skeleton-branch-view"]')).toBeNull()
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}
