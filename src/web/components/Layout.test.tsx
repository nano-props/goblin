// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after, afterSize }: { before: ReactNode; after: ReactNode; afterSize: number }) => (
    <div data-testid="mock-split-pane" data-after-size={afterSize}>
      {before}
      {after}
    </div>
  ),
}))

describe('CompactRepoWorkspace', () => {
  test('marks the inactive pane inert while sharing workspace motion tokens', () => {
    const { container, rerender } = renderCompactWorkspace('navigator')

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactWorkspace(container)?.style.getPropertyValue('--goblin-workspace-pane-transition-duration')).toBe(
      `${WORKSPACE_PANE_TRANSITION_MS}ms`,
    )
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'navigator')?.hasAttribute('inert')).toBe(false)
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.hasAttribute('inert')).toBe(true)

    rerender(
      <CompactRepoWorkspace
        activePane="workspace"
        branchNavigatorPane={<button type="button">navigator</button>}
        repoWorkspacePane={<button type="button">workspace</button>}
      />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'navigator')?.hasAttribute('inert')).toBe(true)
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.hasAttribute('inert')).toBe(false)
  })
})

describe('RepoWorkspace', () => {
  test('defaults the split layout to a 30/70 sidebar/workspace ratio', () => {
    const { container } = renderInJsdom(
      <RepoWorkspace branchNavigatorPane={<div>navigator</div>} repoWorkspacePane={<div>workspace</div>} />,
    )

    expect(splitPane(container)?.dataset.afterSize).toBe('70')
  })
})

function renderCompactWorkspace(activePane: 'navigator' | 'workspace') {
  return renderInJsdom(
    <CompactRepoWorkspace
      activePane={activePane}
      branchNavigatorPane={<button type="button">navigator</button>}
      repoWorkspacePane={<button type="button">workspace</button>}
    />,
  )
}

function compactWorkspace(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-compact-workspace]') ?? null
}

function compactPane(container: HTMLElement, pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`) ?? null
}

function splitPane(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="mock-split-pane"]') ?? null
}
