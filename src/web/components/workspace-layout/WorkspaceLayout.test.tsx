// @vitest-environment jsdom

import type { VNodeChild } from 'vue'
import { describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { CompactWorkspaceLayout, WorkspaceSplitLayout } from '#/web/components/workspace-layout/WorkspaceLayout.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

vi.mock('#/web/components/SplitPane.tsx', () => ({
  SplitPane: ({ before, after, afterSize }: { before: VNodeChild; after: VNodeChild; afterSize: number }) => (
    <div data-testid="mock-split-pane" data-after-size={afterSize}>
      {before}
      {after}
    </div>
  ),
}))

describe('CompactWorkspaceLayout', () => {
  test('marks the inactive pane inert while sharing workspace motion tokens', async () => {
    const { container, rerender } = renderCompactWorkspace('navigator')

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactWorkspace(container)?.style.getPropertyValue('--goblin-workspace-pane-transition-duration')).toBe(
      `${WORKSPACE_PANE_TRANSITION_MS}ms`,
    )
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'navigator')?.hasAttribute('inert')).toBe(false)
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.hasAttribute('inert')).toBe(true)

    await rerender(
      <CompactWorkspaceLayout
        activePane="workspace"
        sidebarPane={<button type="button">navigator</button>}
        workspacePane={<button type="button">workspace</button>}
      />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'navigator')?.hasAttribute('inert')).toBe(true)
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.hasAttribute('inert')).toBe(false)
  })

  test.each([
    {
      pane: 'workspace',
      initialActivePane: 'workspace',
      nextActivePane: 'navigator',
      initialSidebar: 'navigator',
      nextSidebar: 'navigator',
      initialWorkspace: 'workspace-a',
      nextWorkspace: 'workspace-b',
    },
    {
      pane: 'navigator',
      initialActivePane: 'navigator',
      nextActivePane: 'workspace',
      initialSidebar: 'navigator-a',
      nextSidebar: 'navigator-b',
      initialWorkspace: 'workspace',
      nextWorkspace: 'workspace',
    },
  ] as const)('retains the outgoing $pane pane content for the slide-out transition', async (scenario) => {
    useFakeTimers()
    const { container, rerender } = renderInJsdom(
      <CompactWorkspaceLayout
        activePane={scenario.initialActivePane}
        sidebarPane={<div>{scenario.initialSidebar}</div>}
        workspacePane={<div>{scenario.initialWorkspace}</div>}
        transitionScopeKey="repo-a"
      />,
    )

    await rerender(
      <CompactWorkspaceLayout
        activePane={scenario.nextActivePane}
        sidebarPane={<div>{scenario.nextSidebar}</div>}
        workspacePane={<div>{scenario.nextWorkspace}</div>}
        transitionScopeKey="repo-a"
      />,
    )

    const outgoingPane = compactPane(container, scenario.pane)
    const initialContent = scenario.pane === 'navigator' ? scenario.initialSidebar : scenario.initialWorkspace
    const nextContent = scenario.pane === 'navigator' ? scenario.nextSidebar : scenario.nextWorkspace
    expect(outgoingPane?.textContent).toContain(initialContent)
    expect(outgoingPane?.textContent).not.toContain(nextContent)

    await flushTestUpdates(() => {
      vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
    })

    expect(outgoingPane?.textContent).toContain(nextContent)
  })

  test('does not retain outgoing pane content across transition scopes', async () => {
    useFakeTimers()
    const { container, rerender } = renderInJsdom(
      <CompactWorkspaceLayout
        activePane="workspace"
        sidebarPane={<div>navigator</div>}
        workspacePane={<div>workspace-a</div>}
        transitionScopeKey="repo-a"
      />,
    )

    await rerender(
      <CompactWorkspaceLayout
        activePane="navigator"
        sidebarPane={<div>navigator</div>}
        workspacePane={<div>workspace-b</div>}
        transitionScopeKey="repo-b"
      />,
    )

    expect(compactPane(container, 'workspace')?.textContent).toContain('workspace-b')
    expect(compactPane(container, 'workspace')?.textContent).not.toContain('workspace-a')
  })
})

describe('WorkspaceSplitLayout', () => {
  test('defaults the split layout to a 30/70 sidebar/workspace ratio', () => {
    const { container } = renderInJsdom(
      <WorkspaceSplitLayout sidebarPane={<div>navigator</div>} workspacePane={<div>workspace</div>} />,
    )

    expect(splitPane(container)?.dataset.afterSize).toBe('70')
  })
})

function renderCompactWorkspace(activePane: 'navigator' | 'workspace') {
  return renderInJsdom(
    <CompactWorkspaceLayout
      activePane={activePane}
      sidebarPane={<button type="button">navigator</button>}
      workspacePane={<button type="button">workspace</button>}
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
