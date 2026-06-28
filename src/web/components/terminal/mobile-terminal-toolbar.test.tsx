// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { MobileTerminalToolbar } from '#/web/components/terminal/mobile-terminal-toolbar.tsx'

function render(
  props: {
    onInput?: (data: string) => void
    onScrollLines?: (amount: number) => void
    disabled?: boolean
  } = {},
) {
  return renderInJsdom(
    <MobileTerminalToolbar
      onInput={props.onInput ?? vi.fn()}
      onScrollLines={props.onScrollLines}
      disabled={props.disabled}
    />,
  )
}

function clickButton(container: HTMLElement, visibleLabel: string) {
  // Match by the visible glyph only (the first child span is
  // aria-hidden, so its text alone identifies the button).
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.querySelector('[aria-hidden="true"]')?.textContent === visibleLabel,
  ) as HTMLButtonElement
  expect(button, `expected a button with visible label ${visibleLabel}`).toBeTruthy()
  act(() => {
    button.click()
  })
}

function clickButtonByAccessibleName(container: HTMLElement, labelPrefix: string) {
  // The toolbar exposes accessible names via an sr-only span, not
  // aria-label — iOS Safari pops a native callout on long-press of
  // any element whose accessible name comes from aria-label. Reading
  // the sr-only text mirrors how an assistive technology would.
  const button = Array.from(container.querySelectorAll('button')).find((element) =>
    element.querySelector('.sr-only')?.textContent?.startsWith(labelPrefix),
  ) as HTMLButtonElement | null
  expect(button, `expected a button whose accessible name starts with ${labelPrefix}`).toBeTruthy()
  act(() => {
    button!.click()
  })
}

describe('MobileTerminalToolbar', () => {
  test('Escape and Tab send their bytes verbatim', () => {
    const onInput = vi.fn()
    const { container } = render({ onInput })
    clickButton(container, '⎋')
    clickButton(container, '⇥')
    expect(onInput).toHaveBeenNthCalledWith(1, '\x1b')
    expect(onInput).toHaveBeenNthCalledWith(2, '\t')
  })

  test('Ctrl+C shortcut button sends the interrupt byte directly', () => {
    const onInput = vi.fn()
    const { container } = render({ onInput })
    clickButtonByAccessibleName(container, 'Ctrl+C')
    expect(onInput).toHaveBeenCalledWith('\x03')
  })

  test('Page Up/Page Down scroll without sending input', () => {
    const onInput = vi.fn()
    const onScrollLines = vi.fn()
    const { container } = render({ onInput, onScrollLines })
    clickButtonByAccessibleName(container, 'Page Up')
    clickButtonByAccessibleName(container, 'Page Down')
    expect(onScrollLines).toHaveBeenNthCalledWith(1, -12)
    expect(onScrollLines).toHaveBeenNthCalledWith(2, 12)
    expect(onInput).not.toHaveBeenCalled()
  })

  test('Buttons honour the disabled prop', () => {
    const { container } = render({ disabled: true })
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  test('Buttons have neither `title` nor `aria-label` (iOS Safari long-press callout)', () => {
    // iOS Safari pops a native tooltip on long-press of any element
    // whose accessible name is exposed via either the `title` HTML
    // attribute or the `aria-label` ARIA attribute. The mobile
    // toolbar is touch-only, so both are unset and the accessible
    // name is provided by an sr-only text child instead — which
    // iOS does not treat as a tooltip source.
    const { container } = render({})
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.hasAttribute('title')).toBe(false)
      expect(button.hasAttribute('aria-label')).toBe(false)
      expect(button.querySelector('.sr-only')?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })
})
