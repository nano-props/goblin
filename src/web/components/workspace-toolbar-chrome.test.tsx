// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceChrome, WorkspaceToolbar } from '#/web/components/workspace-toolbar-chrome.tsx'
import { WORKSPACE_TOOLBAR_HEIGHT_PX } from '#/web/components/workspace-toolbar-layout.ts'

describe('WorkspaceToolbar', () => {
  test('owns workspace chrome without inheriting a generic toolbar gap', () => {
    const { container } = renderInJsdom(
      <WorkspaceToolbar>
        <div data-testid="body" />
      </WorkspaceToolbar>,
    )

    const toolbar = workspaceToolbar(container)
    expect(toolbar).not.toBeNull()
    expect(toolbar?.className).toContain('goblin-workspace-toolbar')

    expect(toolbar?.className).toContain('gap-0')
    expect(toolbar?.className).toContain('border-border/60')
    expect(toolbar?.className).not.toContain('gap-2')
    expect(toolbar?.className).not.toContain('goblin-workspace-toolbar--compact')
    expect(toolbar?.style.height).toBe(`${WORKSPACE_TOOLBAR_HEIGHT_PX}px`)
    expect(container.querySelector('[data-testid="body"]')).not.toBeNull()
  })

  test('keeps compact/non-expanded chrome padded without opting into window dragging', () => {
    renderInJsdom(
      <WorkspaceToolbar expanded={false}>
        <div />
      </WorkspaceToolbar>,
    )

    const toolbar = workspaceToolbar(document.body)
    expect(toolbar?.className).toContain('goblin-workspace-toolbar--compact')

    expect(toolbar?.className).not.toContain('title-bar-chrome')
  })

  test('reserves navigation controls when requested', () => {
    const { container } = renderInJsdom(<WorkspaceChrome navigationOffset />)

    const toolbar = workspaceToolbar(container)
    const spacer = container.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')
    expect(toolbar?.className).toContain('goblin-workspace-toolbar--navigation-offset')

    expect(spacer?.className).toContain('goblin-workspace-toolbar__leading-spacer--reserved')
  })
})

function workspaceToolbar(container: HTMLElement | null | undefined): HTMLElement | null {
  return container?.querySelector<HTMLElement>('.goblin-workspace-toolbar') ?? null
}
