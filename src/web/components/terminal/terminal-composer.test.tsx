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
  close: 'Collapse',
  inputPlaceholder: 'Enter a terminal command',
  more: 'More actions',
  uploadFiles: 'Upload',
  showKeys: 'Show terminal keys',
  showInput: 'Show text input',
  enter: 'Enter',
  backspace: 'Backspace',
  tab: 'Tab',
  arrowUp: 'Arrow Up',
  arrowDown: 'Arrow Down',
  arrowLeft: 'Arrow Left',
  arrowRight: 'Arrow Right',
  escape: 'Escape',
  ctrlC: 'Ctrl+C',
  ctrlD: 'Ctrl+D',
  pageUp: 'Page Up (scroll up)',
  pageDown: 'Page Down (scroll down)',
}

function render(
  props: {
    onVirtualKey?: (key: TerminalVirtualKey) => void
    onSendText?: (text: string) => boolean
    onResolveFiles?: (files: File[]) => Promise<string | null>
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
      onResolveFiles={props.onResolveFiles ?? vi.fn(async () => null)}
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

function showInput(container: HTMLElement) {
  act(() => buttonByAccessibleName(container, LABELS.showInput).click())
}

function openMoreMenu(container: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(buttonByAccessibleName(container, LABELS.more), { button: 0, ctrlKey: false })
  })
}

function menuItemByText(text: string) {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')).find((element) =>
    element.textContent?.includes(text),
  )
  if (!item) throw new Error(`expected menu item named ${text}`)
  return item
}

describe('TerminalComposer', () => {
  test('starts as one floating action and expands into the composer', async () => {
    const { container } = render()
    const openButton = buttonByAccessibleName(container, LABELS.open)
    const surface = container.querySelector('.goblin-terminal-composer__surface')
    expect(openButton.getAttribute('aria-expanded')).toBe('false')
    expect(surface?.getAttribute('aria-hidden')).toBe('true')
    expect(surface?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('textarea')).toBeNull()

    expand(container)

    expect(openButton.getAttribute('aria-expanded')).toBe('true')
    expect(surface?.getAttribute('aria-hidden')).toBe('false')
    expect(surface?.hasAttribute('inert')).toBe(false)
    const modeRow = container.querySelector('.goblin-terminal-composer__mode-row')
    const showInputButton = buttonByAccessibleName(container, LABELS.showInput)
    const more = buttonByAccessibleName(container, LABELS.more)
    expect(showInputButton.parentElement).toBe(modeRow)
    expect(more.parentElement).toBe(modeRow)
    expect(more.querySelector('.lucide-ellipsis')).not.toBeNull()
    expect(container.querySelector('.goblin-terminal-composer--expanded')).not.toBeNull()

    openMoreMenu(container)
    act(() => menuItemByText(LABELS.close).click())
    expect(surface?.getAttribute('aria-hidden')).toBe('true')
    expect(surface?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('textarea')).toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(openButton))
  })

  test('submits with Enter and clears only accepted text', () => {
    const onSendText = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { container } = render({ onSendText })
    expand(container)
    showInput(container)
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
    showInput(container)
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
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 156 })

    fireEvent.change(input, { target: { value: 'one\ntwo\nthree\nfour\nfive\nsix' } })

    expect(input.style.height).toBe('120px')
  })

  test('keeps an empty input at 40px even when the placeholder wraps during expansion', () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 156 })

    expect(input.style.height).toBe('40px')
  })

  test('inserts resolved file paths at the input selection and permits selecting the same file again', async () => {
    const resolvedPath = "'/tmp/notes file.txt'"
    const onResolveFiles = vi.fn(async () => resolvedPath)
    const { container } = render({ onResolveFiles })
    expand(container)
    showInput(container)
    const textarea = container.querySelector('textarea')
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!textarea || !fileInput) throw new Error('expected composer inputs')
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(textarea, { target: { value: 'cat done' } })
    textarea.setSelectionRange(4, 4)
    openMoreMenu(container)
    act(() => menuItemByText(LABELS.uploadFiles).click())

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })

    expect(onResolveFiles).toHaveBeenCalledWith([file])
    expect(textarea.value).toBe("cat '/tmp/notes file.txt' done")
    expect(textarea.selectionStart).toBe(4 + resolvedPath.length)
    expect(fileInput.value).toBe('')
    expect(document.activeElement).toBe(textarea)
  })

  test('sends terminal-mode-aware key intents and scroll actions', () => {
    const onVirtualKey = vi.fn()
    const onScrollLines = vi.fn()
    const { container } = render({ onVirtualKey, onScrollLines })
    expand(container)

    expect(container.querySelector('textarea')).toBeNull()
    expect(
      buttonByAccessibleName(container, LABELS.showInput).querySelector('.lucide-text-cursor-input'),
    ).not.toBeNull()
    expect(buttonByAccessibleName(container, LABELS.more).querySelector('.lucide-ellipsis')).not.toBeNull()

    for (const name of [LABELS.arrowUp, LABELS.arrowDown, LABELS.arrowLeft, LABELS.arrowRight]) {
      act(() => buttonByAccessibleName(container, name).click())
    }
    expect(onVirtualKey.mock.calls.map(([key]) => key)).toEqual(['arrow-up', 'arrow-down', 'arrow-left', 'arrow-right'])
    act(() => buttonByAccessibleName(container, LABELS.pageUp).click())
    act(() => buttonByAccessibleName(container, LABELS.pageDown).click())
    expect(onScrollLines).toHaveBeenNthCalledWith(1, -12)
    expect(onScrollLines).toHaveBeenNthCalledWith(2, 12)

    const optionalActions = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[class*="goblin-terminal-composer__key-action--optional-"]'),
    )
    expect(optionalActions.map((button) => button.querySelector('.sr-only')?.textContent)).toEqual([
      LABELS.enter,
      LABELS.backspace,
      LABELS.tab,
    ])
    const keyRowLabels = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.goblin-terminal-composer__key-row button'),
    ).map((button) => button.querySelector('.sr-only')?.textContent)
    expect(keyRowLabels.slice(0, 3)).toEqual([LABELS.enter, LABELS.backspace, LABELS.tab])
    for (const button of optionalActions) act(() => button.click())
    expect(onVirtualKey.mock.calls.slice(-3).map(([key]) => key)).toEqual(['enter', 'backspace', 'tab'])

    for (const [label, key] of [
      [LABELS.enter, 'enter'],
      [LABELS.backspace, 'backspace'],
      [LABELS.tab, 'tab'],
      [LABELS.escape, 'escape'],
      [LABELS.ctrlC, 'interrupt'],
      [LABELS.ctrlD, 'eof'],
    ] as const) {
      openMoreMenu(container)
      if (key === 'enter') {
        expect(
          Array.from(document.querySelectorAll('[data-terminal-composer-keycap]')).map((keycap) => keycap.textContent),
        ).toEqual(['↵', '⌫', '⇥', 'Esc', '^C', '^D'])
      }
      act(() => menuItemByText(label).click())
      expect(onVirtualKey).toHaveBeenLastCalledWith(key)
    }
  })

  test('mode toggle preserves the draft and virtual keys restore terminal focus only for pointer input', () => {
    const onRequestFocus = vi.fn()
    const { container } = render({ onRequestFocus })
    expand(container)
    showInput(container)
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
    expect(document.activeElement).toBe(container.querySelector('textarea'))
    expect(buttonByAccessibleName(container, LABELS.more)).toBeTruthy()
    expect(buttonByAccessibleName(container, LABELS.showKeys).querySelector('.lucide-keyboard')).not.toBeNull()
  })

  test('restores the last mode after collapsing and reopening', async () => {
    const { container } = render()
    expand(container)
    showInput(container)
    openMoreMenu(container)
    act(() => menuItemByText(LABELS.close).click())
    await vi.waitFor(() =>
      expect(buttonByAccessibleName(container, LABELS.open).getAttribute('aria-expanded')).toBe('false'),
    )

    expand(container)

    expect(container.querySelector('textarea')).not.toBeNull()
    expect(buttonByAccessibleName(container, LABELS.showKeys)).toBeTruthy()
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
