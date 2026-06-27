// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'
import { renderInJsdom } from '#/test-utils/render.tsx'

describe('SidebarRowButton', () => {
  test('uses compact full-width chrome without growing in a vertical flex stack', () => {
    const { container } = renderInJsdom(
      <SidebarRowButton aria-label="Sidebar row">Sidebar row</SidebarRowButton>,
    )

    const button = container.querySelector('button[aria-label="Sidebar row"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('missing sidebar row button')

    expect(button.className).toContain('w-full')
    expect(button.className).toContain('shrink-0')
    expect(button.className).toContain('h-10')
    expect(button.className).not.toContain('flex-1')
  })

  test('owns compact and icon row sizes without caller class overrides', () => {
    const { container } = renderInJsdom(
      <div>
        <SidebarRowButton aria-label="Compact row" size="compact">
          Compact row
        </SidebarRowButton>
        <SidebarRowButton aria-label="Dense row" size="dense">
          Dense row
        </SidebarRowButton>
        <SidebarRowButton aria-label="Icon row" size="icon">
          Icon row
        </SidebarRowButton>
      </div>,
    )

    const compact = container.querySelector('button[aria-label="Compact row"]')
    const dense = container.querySelector('button[aria-label="Dense row"]')
    const icon = container.querySelector('button[aria-label="Icon row"]')
    if (
      !(compact instanceof HTMLButtonElement) ||
      !(dense instanceof HTMLButtonElement) ||
      !(icon instanceof HTMLButtonElement)
    ) {
      throw new Error('missing sidebar row button')
    }

    expect(compact.className).toContain('h-9')
    expect(compact.className).toContain('gap-2')
    expect(compact.className).toContain('px-2.5')
    expect(dense.className).toContain('h-8')
    expect(dense.className).toContain('gap-2')
    expect(dense.className).toContain('px-3')
    expect(dense.className).toContain('font-normal')
    expect(dense.className).toContain('text-foreground/85')
    expect(icon.className).toContain('size-9')
    expect(icon.className).toContain('justify-center')
    expect(icon.className).not.toContain('w-full')
  })
})
