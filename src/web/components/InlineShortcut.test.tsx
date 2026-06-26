// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'

describe('InlineShortcut', () => {
  test('renders the shortcut text', () => {
    const { container } = render(<InlineShortcut shortcut="⌘N" />)
    const span = container.querySelector('span')
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('⌘N')
  })

  test('applies hover-only classes when showOnHover is true', () => {
    const { container } = render(<InlineShortcut shortcut="⌘N" showOnHover={true} />)
    const span = container.querySelector('span')
    expect(span!.className).toContain('opacity-0')
    expect(span!.className).toContain('group-hover:opacity-100')
  })

  test('does not apply hover-only classes by default', () => {
    const { container } = render(<InlineShortcut shortcut="⌘N" />)
    const span = container.querySelector('span')
    expect(span!.className).not.toContain('opacity-0')
  })

  test('forwards aria-hidden to avoid screen-reader duplication', () => {
    const { container } = render(<InlineShortcut shortcut="⌘N" aria-hidden={true} />)
    const span = container.querySelector('span')
    expect(span!.getAttribute('aria-hidden')).toBe('true')
  })

  test('forwards custom className', () => {
    const { container } = render(<InlineShortcut shortcut="⌘N" className="custom-class" />)
    const span = container.querySelector('span')
    expect(span!.className).toContain('custom-class')
  })
})
