// @vitest-environment jsdom

import { act, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { MobileTerminalToolbar } from '#/web/components/terminal/mobile-terminal-toolbar.tsx'
import type { MobileTerminalToolbarLabels } from '#/web/components/terminal/mobile-terminal-toolbar.tsx'
import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

const LABELS: MobileTerminalToolbarLabels = {
  toolbar: 'Terminal input helpers',
  tab: 'Tab',
  arrowUp: 'Arrow Up',
  arrowDown: 'Arrow Down',
  arrowLeft: 'Arrow Left',
  arrowRight: 'Arrow Right',
  escape: 'Escape',
  ctrlC: 'Ctrl+C',
  paste: 'Paste',
  pageUp: 'Page Up (scroll up)',
  pageDown: 'Page Down (scroll down)',
}

function render(
  props: {
    onVirtualKey?: (key: TerminalVirtualKey) => void
    onPaste?: () => void
    onRequestFocus?: () => void
    onScrollLines?: (amount: number) => void
    disabled?: boolean
  } = {},
) {
  return renderInJsdom(
    <MobileTerminalToolbar
      labels={LABELS}
      onVirtualKey={props.onVirtualKey ?? vi.fn()}
      onPaste={props.onPaste ?? vi.fn()}
      onRequestFocus={props.onRequestFocus ?? vi.fn()}
      onScrollLines={props.onScrollLines ?? vi.fn()}
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
  test('Escape and Tab send key intents without owning terminal encoding', () => {
    const onVirtualKey = vi.fn()
    const { container } = render({ onVirtualKey })
    clickButton(container, '⎋')
    clickButton(container, '⇥')
    expect(onVirtualKey).toHaveBeenNthCalledWith(1, 'escape')
    expect(onVirtualKey).toHaveBeenNthCalledWith(2, 'tab')
  })

  test('arrow buttons send terminal-mode-aware key intents', () => {
    const onVirtualKey = vi.fn()
    const { container } = render({ onVirtualKey })
    clickButtonByAccessibleName(container, 'Arrow Up')
    clickButtonByAccessibleName(container, 'Arrow Down')
    clickButtonByAccessibleName(container, 'Arrow Left')
    clickButtonByAccessibleName(container, 'Arrow Right')
    expect(onVirtualKey).toHaveBeenNthCalledWith(1, 'arrow-up')
    expect(onVirtualKey).toHaveBeenNthCalledWith(2, 'arrow-down')
    expect(onVirtualKey).toHaveBeenNthCalledWith(3, 'arrow-left')
    expect(onVirtualKey).toHaveBeenNthCalledWith(4, 'arrow-right')
  })

  test('orders the compact two-column groups by navigation then terminal actions', () => {
    const { container } = render()
    const toolbarGroup = container.querySelector('[role="group"]')
    expect(toolbarGroup?.getAttribute('aria-label')).toBe(LABELS.toolbar)
    const accessibleNames = Array.from(container.querySelectorAll('button')).map(
      (button) => button.querySelector('.sr-only')?.textContent,
    )
    expect(accessibleNames).toEqual([
      'Tab',
      'Arrow Up',
      'Arrow Down',
      'Arrow Left',
      'Arrow Right',
      'Escape',
      'Ctrl+C',
      'Paste',
      'Page Up (scroll up)',
      'Page Down (scroll down)',
    ])
  })

  test('marks only the controls removed by the compact CSS breakpoints', () => {
    const { container } = render()
    const accessibleNames = (selector: string) =>
      Array.from(container.querySelectorAll(selector)).map((button) => button.querySelector('.sr-only')?.textContent)
    expect(accessibleNames('.goblin-terminal-mobile-toolbar__btn--low-priority')).toEqual([
      'Tab',
      'Paste',
      'Page Up (scroll up)',
      'Page Down (scroll down)',
    ])
    expect(accessibleNames('.goblin-terminal-mobile-toolbar__btn--horizontal-arrow')).toEqual([
      'Arrow Left',
      'Arrow Right',
    ])
  })

  test('Ctrl+C shortcut button sends an interrupt intent', () => {
    const onVirtualKey = vi.fn()
    const { container } = render({ onVirtualKey })
    clickButtonByAccessibleName(container, 'Ctrl+C')
    expect(onVirtualKey).toHaveBeenCalledWith('interrupt')
  })

  test('Paste button invokes the clipboard paste action without sending a key intent', () => {
    const onVirtualKey = vi.fn()
    const onPaste = vi.fn()
    const { container } = render({ onVirtualKey, onPaste })
    clickButtonByAccessibleName(container, 'Paste')
    expect(onPaste).toHaveBeenCalledOnce()
    expect(onVirtualKey).not.toHaveBeenCalled()
  })

  test('Page Up/Page Down scroll without sending a key intent', () => {
    const onVirtualKey = vi.fn()
    const onScrollLines = vi.fn()
    const { container } = render({ onVirtualKey, onScrollLines })
    clickButtonByAccessibleName(container, 'Page Up')
    clickButtonByAccessibleName(container, 'Page Down')
    expect(onScrollLines).toHaveBeenNthCalledWith(1, -12)
    expect(onScrollLines).toHaveBeenNthCalledWith(2, 12)
    expect(onVirtualKey).not.toHaveBeenCalled()
  })

  test('prevents pointer activation from taking the current focus', () => {
    const input = document.createElement('textarea')
    document.body.appendChild(input)
    try {
      input.focus()
      const { container } = render()
      const tabButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'Tab',
      )
      if (!tabButton) throw new Error('expected Tab button')

      expect(fireEvent.pointerDown(tabButton)).toBe(false)
      expect(document.activeElement).toBe(input)
    } finally {
      input.remove()
    }
  })

  test('requests terminal focus only for pointer-sourced input actions', () => {
    const onRequestFocus = vi.fn()
    const { container } = render({ onRequestFocus })
    clickButtonByAccessibleName(container, 'Arrow Up')
    clickButtonByAccessibleName(container, 'Paste')
    expect(onRequestFocus).not.toHaveBeenCalled()

    const buttons = Array.from(container.querySelectorAll('button'))
    const arrowUp = buttons.find((button) => button.querySelector('.sr-only')?.textContent === 'Arrow Up')
    const paste = buttons.find((button) => button.querySelector('.sr-only')?.textContent === 'Paste')
    const pageUp = buttons.find((button) => button.querySelector('.sr-only')?.textContent?.startsWith('Page Up'))
    if (!arrowUp || !paste || !pageUp) throw new Error('expected pointer focus test buttons')
    fireEvent.click(arrowUp, { detail: 1 })
    fireEvent.click(paste, { detail: 1 })
    fireEvent.click(pageUp, { detail: 1 })
    expect(onRequestFocus).toHaveBeenCalledTimes(2)
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
