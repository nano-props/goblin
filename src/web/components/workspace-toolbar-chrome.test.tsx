// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspaceChrome, WorkspaceToolbar } from '#/web/components/workspace-toolbar-chrome.tsx'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'

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
    expect(toolbar?.dataset.titleBarChromeRegion).toBe('drag')
    expect(toolbar?.className).toContain('app-drag-region')
    expect(toolbar?.className).toContain('gap-0')
    expect(toolbar?.className).toContain('border-border/60')
    expect(toolbar?.className).not.toContain('gap-2')
    expect(toolbar?.className).not.toContain('goblin-workspace-toolbar--non-draggable')
    expect(toolbar?.style.height).toBe(`${TITLE_BAR_HEIGHT_PX}px`)
    expect(container.querySelector('[data-testid="body"]')).not.toBeNull()
  })

  test('keeps compact/non-draggable chrome padded without opting into window dragging', () => {
    renderInJsdom(
      <WorkspaceToolbar draggable={false}>
        <div />
      </WorkspaceToolbar>,
    )

    const toolbar = workspaceToolbar(document.body)
    expect(toolbar?.className).toContain('goblin-workspace-toolbar--non-draggable')
    expect(toolbar?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(toolbar?.className).not.toContain('app-drag-region')
    expect(toolbar?.className).not.toContain('title-bar-chrome')
  })

  test('reserves traffic-light chrome through WorkspaceChrome only when requested', () => {
    const { container } = renderInJsdom(<WorkspaceChrome trafficLightOffset />)

    const toolbar = workspaceToolbar(container)
    const spacer = container.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')
    const noDrag = container.querySelector<HTMLElement>('[data-testid="workspace-toolbar-leading-no-drag"]')
    expect(toolbar?.className).toContain('goblin-workspace-toolbar--traffic-offset')
    expect(toolbar?.dataset.titleBarChromeRegion).toBe('drag')
    expect(toolbar?.className).toContain('app-drag-region')
    expect(spacer?.className).toContain('goblin-workspace-toolbar__leading-spacer--reserved')
    expect(noDrag?.dataset.titleBarChromeRegion).toBe('no-drag')
  })
})

function workspaceToolbar(container: HTMLElement | null | undefined): HTMLElement | null {
  return container?.querySelector<HTMLElement>('.goblin-workspace-toolbar') ?? null
}
