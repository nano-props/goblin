// @vitest-environment jsdom

import { describe, expect, test } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'

describe('InlineShortcut', () => {
  test('renders the shortcut text', () => {
    const { container } = renderInJsdom(<InlineShortcut shortcut="⌘N" />)
    const span = container.querySelector('span')
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('⌘N')
  })

  test('applies hover-only classes when showOnHover is true', () => {
    const { container } = renderInJsdom(<InlineShortcut shortcut="⌘N" showOnHover={true} />)
    const span = container.querySelector('span')
    expect(span!.className).toContain('opacity-0')
    expect(span!.className).toContain('group-hover:opacity-100')
  })

  test('does not apply hover-only classes by default', () => {
    const { container } = renderInJsdom(<InlineShortcut shortcut="⌘N" />)
    const span = container.querySelector('span')
    expect(span!.className).not.toContain('opacity-0')
  })

  test('forwards aria-hidden to avoid screen-reader duplication', async () => {
    const { container } = renderInJsdom(<InlineShortcut shortcut="⌘N" ariaHidden={true} />)
    const span = container.querySelector('span')
    expect(span!.getAttribute('aria-hidden')).toBe('true')
  })

  test('forwards a custom class', async () => {
    const { container } = renderInJsdom(<InlineShortcut shortcut="⌘N" class="custom-class" />)
    const span = container.querySelector('span')
    expect(span!.className.split(/\s+/).filter((token) => token === 'custom-class')).toHaveLength(1)
  })
})
