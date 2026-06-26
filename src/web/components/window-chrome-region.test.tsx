// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  WindowChromeDragRegion,
  WindowChromeInteractiveRegion,
  WindowChromeNoDragRegion,
} from '#/web/components/window-chrome-region.tsx'

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

describe('window chrome regions', () => {
  test('marks a padded drag region for native window controls', () => {
    render(<WindowChromeDragRegion data-testid="chrome" className="bg-card" />)

    const chrome = element('[data-testid="chrome"]')
    expect(chrome?.dataset.windowChromeRegion).toBe('drag')
    expect(chrome?.className).toContain('window-chrome')
    expect(chrome?.className).toContain('bg-card')
  })

  test('marks an unpadded drag region for toolbar remainder space', () => {
    render(<WindowChromeDragRegion reserveWindowControls={false} data-testid="chrome" />)

    const chrome = element('[data-testid="chrome"]')
    expect(chrome?.dataset.windowChromeRegion).toBe('drag')
    expect(chrome?.className).toContain('app-drag-region')
    expect(chrome?.className).not.toContain('window-chrome')
  })

  test('marks an interactive region as no-drag without adding layout chrome', () => {
    render(<WindowChromeInteractiveRegion data-testid="interactive" className="flex-1" />)

    const interactive = element('[data-testid="interactive"]')
    expect(interactive?.dataset.windowChromeRegion).toBe('interactive')
    expect(interactive?.hasAttribute('data-interactive')).toBe(true)
    expect(interactive?.className).toContain('flex-1')
    expect(interactive?.className).not.toContain('window-chrome')
    expect(interactive?.className).not.toContain('app-drag-region')
  })

  test('can mark a child component root as the interactive region', () => {
    render(
      <WindowChromeInteractiveRegion asChild>
        <div data-testid="interactive-child" className="h-full" />
      </WindowChromeInteractiveRegion>,
    )

    const interactive = element('[data-testid="interactive-child"]')
    expect(interactive?.dataset.windowChromeRegion).toBe('interactive')
    expect(interactive?.hasAttribute('data-interactive')).toBe(true)
    expect(interactive?.className).toContain('h-full')
  })

  test('marks a passive no-drag carve-out without making it interactive', () => {
    render(<WindowChromeNoDragRegion data-testid="no-drag" className="size-8" />)

    const noDrag = element('[data-testid="no-drag"]')
    expect(noDrag?.dataset.windowChromeRegion).toBe('no-drag')
    expect(noDrag?.hasAttribute('data-interactive')).toBe(false)
    expect(noDrag?.className).toContain('size-8')
  })

  test('can mark a child component root as a passive no-drag carve-out', () => {
    render(
      <WindowChromeNoDragRegion asChild>
        <div data-testid="no-drag-child" className="absolute" />
      </WindowChromeNoDragRegion>,
    )

    const noDrag = element('[data-testid="no-drag-child"]')
    expect(noDrag?.dataset.windowChromeRegion).toBe('no-drag')
    expect(noDrag?.hasAttribute('data-interactive')).toBe(false)
    expect(noDrag?.className).toContain('absolute')
  })
})

function render(element: ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function element(selector: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(selector) ?? null
}
