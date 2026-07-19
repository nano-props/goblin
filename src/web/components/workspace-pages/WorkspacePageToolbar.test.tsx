// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { LayoutDashboard } from 'lucide-react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspacePageToolbar } from '#/web/components/workspace-pages/WorkspacePageToolbar.tsx'

describe('WorkspacePageToolbar', () => {
  test('renders a selected workspace-style tab outside compact mode', () => {
    const { container } = renderInJsdom(<WorkspacePageToolbar icon={LayoutDashboard} label="Dashboard" />)

    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    expect(container.querySelector('[role="tab"]')?.getAttribute('aria-selected')).toBe('true')
    expect(container.querySelector('button[aria-label="workspace.back-to-branch-navigator"]')).toBeNull()
  })

  test('renders compact back-title chrome without a tab strip', () => {
    const onBack = vi.fn()
    const { container } = renderInJsdom(
      <WorkspacePageToolbar icon={LayoutDashboard} label="Dashboard" compact onBack={onBack} />,
    )

    expect(container.querySelector('[role="tablist"]')).toBeNull()
    expect(container.textContent).toContain('Dashboard')

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="workspace.back-to-branch-navigator"]')
    back?.click()

    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
