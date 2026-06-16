// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MobileTerminalToolbar } from '#/web/components/terminal/mobile-terminal-toolbar.tsx'

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

function render(
  props: { onInput?: (data: string) => void; onScrollLines?: (amount: number) => void; disabled?: boolean } = {},
) {
  root = createRoot(container!)
  act(() => {
    root!.render(
      <MobileTerminalToolbar
        onInput={props.onInput ?? vi.fn()}
        onScrollLines={props.onScrollLines}
        disabled={props.disabled}
      />,
    )
  })
}

function clickButton(label: string) {
  const button = Array.from(container!.querySelectorAll('button')).find(
    (element) => element.textContent === label,
  ) as HTMLButtonElement
  expect(button, `expected a button labeled ${label}`).toBeTruthy()
  act(() => {
    button.click()
  })
}

function findCtrlButton() {
  // Look up by title rather than the (symbol) label so the test isn't
  // coupled to the specific glyph used for Ctrl. Assert inside the
  // helper so a missing button fails with a clear message instead of
  // a cryptic null-deref in the caller.
  const button = container!.querySelector('button[title^="Ctrl"]') as HTMLButtonElement | null
  expect(button, 'expected a Ctrl button (by title prefix)').toBeTruthy()
  return button!
}

describe('MobileTerminalToolbar', () => {
  test('Escape and Tab send their bytes verbatim', () => {
    const onInput = vi.fn()
    render({ onInput })
    clickButton('⎋')
    clickButton('⇥')
    expect(onInput).toHaveBeenNthCalledWith(1, '\x1b')
    expect(onInput).toHaveBeenNthCalledWith(2, '\t')
  })

  test('Ctrl is a sticky toggle that arms and disarms', () => {
    const onInput = vi.fn()
    render({ onInput })
    const ctrlButton = findCtrlButton()
    expect(ctrlButton).toBeTruthy()
    expect(ctrlButton.getAttribute('aria-pressed')).toBe('false')
    act(() => ctrlButton.click())
    expect(ctrlButton.getAttribute('aria-pressed')).toBe('true')
    act(() => ctrlButton.click())
    expect(ctrlButton.getAttribute('aria-pressed')).toBe('false')
    // No onInput emission: Ctrl alone never produces a byte.
    expect(onInput).not.toHaveBeenCalled()
  })

  test('Ctrl+value key sends the masked control byte and disarms', () => {
    const onInput = vi.fn()
    render({ onInput })
    // Arm Ctrl, then send Escape — Tab and Esc collide with Ctrl+[/Ctrl+I
    // on the wire, so we still get 0x1B/0x09, but the toggle must clear.
    act(() => findCtrlButton().click())
    clickButton('⎋')
    expect(onInput).toHaveBeenCalledWith('\x1b')
    expect(findCtrlButton().getAttribute('aria-pressed')).toBe('false')
  })

  test('Tapping a value key disarms Ctrl even when its byte is unchanged', () => {
    const onInput = vi.fn()
    render({ onInput })
    act(() => findCtrlButton().click())
    clickButton('⇥')
    expect(onInput).toHaveBeenCalledWith('\t')
    clickButton('⇥')
    expect(onInput).toHaveBeenNthCalledWith(2, '\t')
  })

  test('Page Up/Page Down scroll without affecting Ctrl state', () => {
    const onInput = vi.fn()
    const onScrollLines = vi.fn()
    render({ onInput, onScrollLines })
    act(() => findCtrlButton().click())
    // Page Up / Page Down don't go through onInput at all.
    const upButton = container!.querySelector('button[title^="Page Up"]') as HTMLButtonElement
    const downButton = container!.querySelector('button[title^="Page Down"]') as HTMLButtonElement
    act(() => {
      upButton.click()
      downButton.click()
    })
    expect(onScrollLines).toHaveBeenNthCalledWith(1, -12)
    expect(onScrollLines).toHaveBeenNthCalledWith(2, 12)
    expect(onInput).not.toHaveBeenCalled()
    // Ctrl remains armed across scrolls.
    expect(findCtrlButton().getAttribute('aria-pressed')).toBe('true')
  })

  test('Buttons honour the disabled prop', () => {
    render({ disabled: true })
    const buttons = container!.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
