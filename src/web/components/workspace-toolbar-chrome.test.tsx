// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { WorkspaceChrome, WorkspaceToolbar } from '#/web/components/workspace-toolbar-chrome.tsx'
import { WINDOW_CHROME_HEIGHT_PX } from '#/shared/window-chrome.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
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

describe('WorkspaceToolbar', () => {
  test('owns workspace chrome without inheriting a generic toolbar gap', () => {
    render(
      <WorkspaceToolbar>
        <div data-testid="body" />
      </WorkspaceToolbar>,
    )

    const toolbar = workspaceToolbar()
    expect(toolbar).not.toBeNull()
    expect(toolbar?.className).toContain('goblin-workspace-toolbar')
    expect(toolbar?.dataset.windowChromeRegion).toBe('drag')
    expect(toolbar?.className).toContain('app-drag-region')
    expect(toolbar?.className).toContain('gap-0')
    expect(toolbar?.className).toContain('px-1.5')
    expect(toolbar?.className).toContain('border-border/60')
    expect(toolbar?.className).not.toContain('gap-2')
    expect(toolbar?.className).not.toContain('px-2')
    expect(toolbar?.style.height).toBe(`${WINDOW_CHROME_HEIGHT_PX}px`)
    expect(container?.querySelector('[data-testid="body"]')).not.toBeNull()
  })

  test('keeps compact/non-draggable chrome padded without opting into window dragging', () => {
    render(
      <WorkspaceToolbar draggable={false}>
        <div />
      </WorkspaceToolbar>,
    )

    const toolbar = workspaceToolbar()
    expect(toolbar?.className).toContain('px-2')
    expect(toolbar?.dataset.windowChromeRegion).toBeUndefined()
    expect(toolbar?.className).not.toContain('app-drag-region')
    expect(toolbar?.className).not.toContain('window-chrome')
  })

  test('reserves traffic-light chrome through WorkspaceChrome only when requested', () => {
    render(<WorkspaceChrome trafficLightOffset />)

    const toolbar = workspaceToolbar()
    const spacer = container?.querySelector('[data-testid="workspace-toolbar-leading-spacer"]')
    expect(toolbar?.className).toContain('window-chrome')
    expect(toolbar?.dataset.windowChromeRegion).toBe('drag')
    expect(toolbar?.className).not.toContain('app-drag-region')
    expect(spacer?.className).toContain('goblin-workspace-toolbar__leading-spacer--reserved')
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function workspaceToolbar(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('.goblin-workspace-toolbar') ?? null
}
