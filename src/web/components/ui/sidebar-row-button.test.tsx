// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'

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

describe('SidebarRowButton', () => {
  test('uses compact full-width chrome without growing in a vertical flex stack', () => {
    render(<SidebarRowButton aria-label="Sidebar row">Sidebar row</SidebarRowButton>)

    const button = document.body.querySelector('button[aria-label="Sidebar row"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing sidebar row button')

    expect(button.className).toContain('w-full')
    expect(button.className).toContain('shrink-0')
    expect(button.className).toContain('h-10')
    expect(button.className).not.toContain('flex-1')
  })

  test('owns compact and icon row sizes without caller class overrides', () => {
    render(
      <div>
        <SidebarRowButton aria-label="Compact row" size="compact">
          Compact row
        </SidebarRowButton>
        <SidebarRowButton aria-label="Icon row" size="icon">
          Icon row
        </SidebarRowButton>
      </div>,
    )

    const compact = document.body.querySelector('button[aria-label="Compact row"]')
    const icon = document.body.querySelector('button[aria-label="Icon row"]')
    if (!(compact instanceof HTMLButtonElement) || !(icon instanceof HTMLButtonElement)) {
      throw new Error('missing sidebar row button')
    }

    expect(compact.className).toContain('h-9')
    expect(compact.className).toContain('gap-2')
    expect(compact.className).toContain('px-2.5')
    expect(icon.className).toContain('size-9')
    expect(icon.className).toContain('justify-center')
    expect(icon.className).not.toContain('w-full')
  })
})

function render(node: ReactNode) {
  act(() => {
    root?.render(node)
  })
}
