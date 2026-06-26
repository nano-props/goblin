// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ToolbarTabList, ToolbarTabStrip, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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

describe('ToolbarTabStrip', () => {
  test('renders the compact shell as a flex toolbar item', () => {
    render(
      <ToolbarTabStrip
        compact
        compactContent={<div data-testid="compact-marker" />}
        scrollContent={<div data-testid="scroll-marker" />}
      />,
    )

    expect(container?.firstElementChild?.className).toContain('h-full')
    expect(container?.firstElementChild?.className).toContain('flex-1')
    expect(container?.querySelector('[data-testid="compact-marker"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="scroll-marker"]')).toBeNull()
  })

  test('renders the scroll shell without taking over blank-space dragging', () => {
    render(
      <ToolbarTabStrip
        compact={false}
        compactContent={<div data-testid="compact-marker" />}
        scrollContent={
          <div data-testid="scroll-marker">
            <button type="button">Tab</button>
          </div>
        }
      />,
    )

    const host = container?.firstElementChild
    const scrollRoot = host?.firstElementChild
    const dragRemainder = host?.lastElementChild

    expect(host?.className).toContain('h-full')
    expect(host?.className).toContain('flex-1')
    expect(host?.hasAttribute('data-interactive')).toBe(false)
    expect(scrollRoot?.className).toContain('w-fit')
    expect(scrollRoot?.className).toContain('max-w-full')
    expect(scrollRoot?.hasAttribute('data-interactive')).toBe(false)
    expect((scrollRoot as HTMLElement | null)?.dataset.windowChromeRegion).toBeUndefined()
    expect(dragRemainder?.getAttribute('aria-hidden')).toBe('true')
    expect((dragRemainder as HTMLElement | null)?.dataset.windowChromeRegion).toBe('drag')
    expect(dragRemainder?.className).toContain('flex-1')
    expect(container?.querySelector('[data-testid="scroll-marker"]')).not.toBeNull()
    expect(container?.querySelector('button')?.textContent).toBe('Tab')
    expect(container?.querySelector('[data-testid="compact-marker"]')).toBeNull()
  })
})

describe('ToolbarTabStripBody', () => {
  test('adds the shared scroll-row width contract only when scroll is enabled', () => {
    render(
      <div>
        <ToolbarTabStripBody data-testid="compact-body" />
        <ToolbarTabStripBody scroll data-testid="scroll-body" />
        <ToolbarTabList data-testid="tablist" />
      </div>,
    )

    expect(container?.querySelector('[data-testid="compact-body"]')?.className).not.toContain('w-max')
    expect(container?.querySelector('[data-testid="scroll-body"]')?.className).toContain('w-max')
    expect(container?.querySelector('[data-testid="scroll-body"]')?.className).toContain('min-w-full')
    expect(container?.querySelector('[data-testid="tablist"]')?.className).toContain('h-full')
    expect(container?.querySelector('[data-testid="tablist"]')?.className).toContain('min-w-0')
  })
})

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}
