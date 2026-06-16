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
  props: {
    onInput?: (data: string) => void
    onPaste?: () => void | Promise<void>
    onScrollLines?: (amount: number) => void
    disabled?: boolean
  } = {},
) {
  root = createRoot(container!)
  act(() => {
    root!.render(
      <MobileTerminalToolbar
        onInput={props.onInput ?? vi.fn()}
        onPaste={props.onPaste}
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

function clickButtonByTitle(titlePrefix: string) {
  const button = container!.querySelector(`button[title^="${titlePrefix}"]`) as HTMLButtonElement | null
  expect(button, `expected a button titled ${titlePrefix}`).toBeTruthy()
  act(() => {
    button!.click()
  })
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

  test('Ctrl+C shortcut button sends the interrupt byte directly', () => {
    const onInput = vi.fn()
    render({ onInput })
    clickButtonByTitle('Ctrl+C')
    expect(onInput).toHaveBeenCalledWith('\x03')
  })

  test('Page Up/Page Down scroll without sending input', () => {
    const onInput = vi.fn()
    const onScrollLines = vi.fn()
    render({ onInput, onScrollLines })
    const upButton = container!.querySelector('button[title^="Page Up"]') as HTMLButtonElement
    const downButton = container!.querySelector('button[title^="Page Down"]') as HTMLButtonElement
    act(() => {
      upButton.click()
      downButton.click()
    })
    expect(onScrollLines).toHaveBeenNthCalledWith(1, -12)
    expect(onScrollLines).toHaveBeenNthCalledWith(2, 12)
    expect(onInput).not.toHaveBeenCalled()
  })

  test('Paste button invokes the paste handler', () => {
    const onPaste = vi.fn()
    render({ onPaste })
    clickButtonByTitle('Paste')
    expect(onPaste).toHaveBeenCalledTimes(1)
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
