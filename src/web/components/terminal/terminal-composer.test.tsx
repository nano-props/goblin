// @vitest-environment jsdom

import { act, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { TerminalComposer } from '#/web/components/terminal/terminal-composer.tsx'
import type { TerminalComposerLabels } from '#/web/components/terminal/terminal-composer.tsx'
import type { TerminalVirtualKey } from '#/web/components/terminal/types.ts'

const LABELS: TerminalComposerLabels = {
  composer: 'Terminal input composer',
  open: 'Open terminal composer',
  close: 'Collapse terminal composer',
  inputPlaceholder: 'Enter a terminal command',
  selectFiles: 'Select files',
  showKeys: 'Show terminal keys',
  showInput: 'Show text input',
  tab: 'Tab',
  arrowUp: 'Arrow Up',
  arrowDown: 'Arrow Down',
  arrowLeft: 'Arrow Left',
  arrowRight: 'Arrow Right',
  escape: 'Escape',
  ctrlC: 'Ctrl+C',
  pageUp: 'Page Up (scroll up)',
  pageDown: 'Page Down (scroll down)',
}

function render(
  props: {
    onVirtualKey?: (key: TerminalVirtualKey) => void
    onSendText?: (text: string) => boolean
    onSelectFiles?: (files: File[]) => void
    onRequestFocus?: () => void
    onScrollLines?: (amount: number) => void
    disabled?: boolean
  } = {},
) {
  return renderInJsdom(
    <TerminalComposer
      labels={LABELS}
      onVirtualKey={props.onVirtualKey ?? vi.fn()}
      onSendText={props.onSendText ?? vi.fn(() => true)}
      onSelectFiles={props.onSelectFiles ?? vi.fn()}
      onRequestFocus={props.onRequestFocus ?? vi.fn()}
      onScrollLines={props.onScrollLines ?? vi.fn()}
      disabled={props.disabled}
    />,
  )
}

function buttonByAccessibleName(container: HTMLElement, name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.querySelector('.sr-only')?.textContent === name,
  )
  if (!button) throw new Error(`expected button named ${name}`)
  return button
}

function expand(container: HTMLElement) {
  act(() => buttonByAccessibleName(container, LABELS.open).click())
}

describe('TerminalComposer', () => {
  test('starts as one floating action and expands into the composer', () => {
    const { container } = render()
    const openButton = buttonByAccessibleName(container, LABELS.open)
    const surface = container.querySelector('.goblin-terminal-composer__surface')
    expect(openButton.getAttribute('aria-expanded')).toBe('false')
    expect(surface?.getAttribute('aria-hidden')).toBe('true')
    expect(surface?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('textarea')).not.toBeNull()

    expand(container)

    expect(openButton.getAttribute('aria-expanded')).toBe('true')
    expect(surface?.getAttribute('aria-hidden')).toBe('false')
    expect(surface?.hasAttribute('inert')).toBe(false)
    const input = container.querySelector('textarea')
    const modeRow = container.querySelector('.goblin-terminal-composer__mode-row')
    const showKeys = buttonByAccessibleName(container, LABELS.showKeys)
    const selectFiles = buttonByAccessibleName(container, LABELS.selectFiles)
    const close = buttonByAccessibleName(container, LABELS.close)
    expect(input?.getAttribute('placeholder')).toBe(LABELS.inputPlaceholder)
    expect(showKeys.parentElement).toBe(modeRow)
    expect(input?.parentElement).toBe(modeRow)
    expect(selectFiles.parentElement).toBe(modeRow)
    expect(selectFiles.querySelector('.lucide-plus')).not.toBeNull()
    expect(close.parentElement).toBe(modeRow)
    expect(container.querySelector('.goblin-terminal-composer--expanded')).not.toBeNull()

    act(() => close.click())
    expect(surface?.getAttribute('aria-hidden')).toBe('true')
    expect(surface?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  test('submits with Enter and clears only accepted text', () => {
    const onSendText = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { container } = render({ onSendText })
    expand(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    fireEvent.change(input, { target: { value: 'git status' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendText).toHaveBeenNthCalledWith(1, 'git status')
    expect(input.value).toBe('git status')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendText).toHaveBeenNthCalledWith(2, 'git status')
    expect(input.value).toBe('')
  })

  test('Enter submits while Shift+Enter remains available for text entry', () => {
    const onSendText = vi.fn(() => true)
    const { container } = render({ onSendText })
    expand(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    fireEvent.change(input, { target: { value: 'pwd' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSendText).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendText).toHaveBeenCalledWith('pwd')
  })

  test('grows with multiline text until the five-line cap, then leaves overflow to the textarea', () => {
    const { container } = render()
    expand(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 156 })

    fireEvent.change(input, { target: { value: 'one\ntwo\nthree\nfour\nfive\nsix' } })

    expect(input.style.height).toBe('120px')
  })

  test('keeps an empty input at 40px even when the placeholder wraps during expansion', () => {
    const { container } = render()
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 156 })

    expand(container)

    expect(input.style.height).toBe('40px')
  })

  test('passes selected files to the terminal file boundary and permits selecting the same file again', () => {
    const onSelectFiles = vi.fn()
    const { container } = render({ onSelectFiles })
    expand(container)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('expected file input')
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' })

    fireEvent.change(input, { target: { files: [file] } })

    expect(onSelectFiles).toHaveBeenCalledWith([file])
    expect(input.value).toBe('')
  })

  test('sends terminal-mode-aware key intents and scroll actions', () => {
    const onVirtualKey = vi.fn()
    const onScrollLines = vi.fn()
    const { container } = render({ onVirtualKey, onScrollLines })
    expand(container)
    act(() => buttonByAccessibleName(container, LABELS.showKeys).click())

    expect(container.querySelector('textarea')).toBeNull()
    expect(buttonByAccessibleName(container, LABELS.showInput)).toBeTruthy()

    for (const name of [
      LABELS.escape,
      LABELS.tab,
      LABELS.arrowUp,
      LABELS.arrowDown,
      LABELS.arrowLeft,
      LABELS.arrowRight,
    ]) {
      act(() => buttonByAccessibleName(container, name).click())
    }
    expect(onVirtualKey.mock.calls.map(([key]) => key)).toEqual([
      'escape',
      'tab',
      'arrow-up',
      'arrow-down',
      'arrow-left',
      'arrow-right',
    ])
    act(() => buttonByAccessibleName(container, LABELS.ctrlC).click())
    expect(onVirtualKey).toHaveBeenLastCalledWith('interrupt')
    act(() => buttonByAccessibleName(container, LABELS.pageUp).click())
    act(() => buttonByAccessibleName(container, LABELS.pageDown).click())
    expect(onScrollLines).toHaveBeenNthCalledWith(1, -12)
    expect(onScrollLines).toHaveBeenNthCalledWith(2, 12)
  })

  test('mode toggle preserves the draft and virtual keys restore terminal focus only for pointer input', () => {
    const onRequestFocus = vi.fn()
    const { container } = render({ onRequestFocus })
    expand(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    fireEvent.change(input, { target: { value: 'draft command' } })
    act(() => buttonByAccessibleName(container, LABELS.showKeys).click())
    const arrowUp = buttonByAccessibleName(container, LABELS.arrowUp)

    expect(fireEvent.pointerDown(arrowUp)).toBe(false)
    act(() => arrowUp.click())
    expect(onRequestFocus).not.toHaveBeenCalled()
    fireEvent.click(arrowUp, { detail: 1 })
    expect(onRequestFocus).toHaveBeenCalledOnce()

    act(() => buttonByAccessibleName(container, LABELS.showInput).click())
    expect(container.querySelector('textarea')?.value).toBe('draft command')
  })

  test('buttons honour disabled and avoid iOS long-press callout attributes', () => {
    const { container } = render({ disabled: true })
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(1)
    for (const button of buttons) {
      expect(button.disabled).toBe(true)
      expect(button.hasAttribute('title')).toBe(false)
      expect(button.hasAttribute('aria-label')).toBe(false)
      expect(button.querySelector('.sr-only')?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })
})
