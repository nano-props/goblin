// @vitest-environment jsdom

import { act, createEvent, fireEvent, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { useLayoutEffect, useState } from 'react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { TerminalComposer } from '#/web/components/terminal/terminal-composer.tsx'
import type { TerminalComposerLabels } from '#/web/components/terminal/terminal-composer.tsx'
import type { TerminalComposerMode, TerminalVirtualKey } from '#/web/components/terminal/types.ts'
import { TerminalComposerHistoryCursor } from '#/web/components/terminal/terminal-composer-history-cursor.ts'

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
  ctrlL: 'Ctrl+L',
  ctrlC: 'Ctrl+C',
  ctrlD: 'Ctrl+D',
}

function render(
  props: {
    onVirtualKey?: (key: TerminalVirtualKey) => void
    onSendText?: (text: string) => Promise<boolean>
    onResolveFiles?: (files: File[]) => Promise<string | null>
    initialMode?: TerminalComposerMode
    initialDraft?: string
    draftReplaceAccepted?: boolean
  } = {},
) {
  function ControlledComposer() {
    const [expanded, setExpanded] = useState(false)
    const [mode, setMode] = useState<TerminalComposerMode>(props.initialMode ?? 'keys')
    const [draft, setDraft] = useState(props.initialDraft ?? '')
    const [historyEntries, setHistoryEntries] = useState<readonly string[]>([])
    const sendText = async (text: string) => {
      const accepted = await (props.onSendText ?? (async () => true))(text)
      if (accepted) {
        setHistoryEntries((current) => (current.at(-1) === text ? current : [...current, text]))
      }
      return accepted
    }
    return (
      <TerminalComposer
        labels={LABELS}
        expanded={expanded}
        mode={mode}
        draft={draft}
        historyEntries={historyEntries}
        shortcut="Control+Shift+Enter"
        onVirtualKey={props.onVirtualKey ?? vi.fn()}
        onSendText={sendText}
        onOpen={() => {
          setExpanded(true)
          setMode('input')
          return true
        }}
        onClose={() => {
          setExpanded(false)
          return true
        }}
        onModeChange={(next) => {
          setMode(next)
          return true
        }}
        onDraftChange={(next) => {
          setDraft(next)
          return true
        }}
        onDraftReplace={(expectedDraft, next) => {
          if (props.draftReplaceAccepted === false) return false
          setDraft((current) => (current === expectedDraft ? next : current))
          return true
        }}
        onResolveFiles={props.onResolveFiles ?? vi.fn(async () => null)}
      />
    )
  }
  return renderInJsdom(<ControlledComposer />)
}

function buttonByAccessibleName(container: HTMLElement, name: string) {
  return within(container).getByRole('button', { name })
}

function expand(container: HTMLElement) {
  act(() => buttonByAccessibleName(container, LABELS.open).click())
}

function showInput(container: HTMLElement) {
  const button = within(container).queryByRole('button', { name: LABELS.showInput })
  if (button) act(() => button.click())
}

function openMoreMenu(container: HTMLElement) {
  const more = buttonByAccessibleName(container, LABELS.more)
  more.focus()
  act(() => more.click())
}

function menuItemByText(text: string) {
  const content = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
  if (!content) throw new Error('expected open composer menu')
  return within(content).getByRole('button', { name: text })
}

function ExpandedComposerForTest({
  historyEntries,
  initialDraft,
  onDraftReplaceObserved,
}: {
  historyEntries: readonly string[]
  initialDraft: string
  onDraftReplaceObserved?: (expectedDraft: string, nextDraft: string) => void
}) {
  const [draft, setDraft] = useState(initialDraft)
  return (
    <TerminalComposer
      labels={LABELS}
      expanded
      mode="input"
      draft={draft}
      historyEntries={historyEntries}
      shortcut="Control+Shift+Enter"
      onVirtualKey={vi.fn()}
      onSendText={vi.fn(async () => true)}
      onOpen={vi.fn(() => true)}
      onClose={vi.fn(() => true)}
      onModeChange={vi.fn(() => true)}
      onDraftChange={(next) => {
        setDraft(next)
        return true
      }}
      onDraftReplace={(expectedDraft, next) => {
        onDraftReplaceObserved?.(expectedDraft, next)
        setDraft((current) => (current === expectedDraft ? next : current))
        return true
      }}
      onResolveFiles={vi.fn(async () => null)}
    />
  )
}

function expandedComposerForTest(sessionId: string, historyEntries: readonly string[] = [], draft = '') {
  return <ExpandedComposerForTest key={sessionId} historyEntries={historyEntries} initialDraft={draft} />
}

describe('TerminalComposer', () => {
  function withNavigatorPlatform(platform: string, callback: () => void) {
    const original = navigator.platform
    Object.defineProperty(navigator, 'platform', { configurable: true, value: platform })
    try {
      callback()
    } finally {
      Object.defineProperty(navigator, 'platform', { configurable: true, value: original })
    }
  }

  async function withNavigatorPlatformAsync(platform: string, callback: () => Promise<void>) {
    const original = navigator.platform
    Object.defineProperty(navigator, 'platform', { configurable: true, value: platform })
    try {
      await callback()
    } finally {
      Object.defineProperty(navigator, 'platform', { configurable: true, value: original })
    }
  }

  test('handles macOS Ctrl+W and restores the caret after an accepted edit', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'git commit --message' } })
      input.setSelectionRange(input.value.length, input.value.length)

      fireEvent.keyDown(input, { code: 'KeyW', key: 'w', ctrlKey: true })

      expect(input.value).toBe('git commit ')
      expect(input.selectionStart).toBe('git commit '.length)
    })
  })

  test('handles Ctrl+W in the middle of a word without deleting text to the right', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'echo foobar tail' } })
      input.setSelectionRange('echo foo'.length, 'echo foo'.length)

      fireEvent.keyDown(input, { code: 'KeyW', key: 'w', ctrlKey: true })

      expect(input.value).toBe('echo bar tail')
      expect(input.selectionStart).toBe('echo '.length)
    })
  })

  test('handles Ctrl+U without deleting the current line ending', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'first line\nsecond line' } })
      input.setSelectionRange('first line\nsecond '.length, 'first line\nsecond '.length)

      fireEvent.keyDown(input, { code: 'KeyU', key: 'u', ctrlKey: true })

      expect(input.value).toBe('first line\nline')
      expect(input.selectionStart).toBe('first line\n'.length)
    })
  })

  test('keeps CRLF draft offsets aligned with the normalized textarea', () => {
    withNavigatorPlatform('MacIntel', () => {
      const onDraftReplaceObserved = vi.fn()
      const { container } = renderInJsdom(
        <ExpandedComposerForTest
          historyEntries={[]}
          initialDraft={'first line\r\nsecond line'}
          onDraftReplaceObserved={onDraftReplaceObserved}
        />,
      )
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      expect(input.value).toBe('first line\nsecond line')
      input.setSelectionRange(input.value.length, input.value.length)

      fireEvent.keyDown(input, { code: 'KeyU', key: 'u', ctrlKey: true })

      expect(onDraftReplaceObserved).toHaveBeenCalledWith('first line\r\nsecond line', 'first line\r\n')
      expect(input.value).toBe('first line\n')
      expect(input.selectionStart).toBe('first line\n'.length)
    })
  })

  test('consumes an empty edit without publishing or moving the caret', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'line\ntwo' } })
      input.setSelectionRange('line\n'.length, 'line\n'.length)
      const event = createEvent.keyDown(input, { code: 'KeyW', ctrlKey: true })

      fireEvent(input, event)

      expect(event.defaultPrevented).toBe(true)
      expect(input.value).toBe('line\ntwo')
      expect(input.selectionStart).toBe('line\n'.length)
    })
  })

  test('deletes a selection and places the caret at its start for Ctrl+U', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'before selected after' } })
      input.setSelectionRange(6, 15)

      fireEvent.keyDown(input, { code: 'KeyU', ctrlKey: true })

      expect(input.value).toBe('before after')
      expect(input.selectionStart).toBe(6)
    })
  })

  test('does not leave a pending caret after a rejected replacement', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render({ draftReplaceAccepted: false })
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'abc' } })
      input.setSelectionRange(3, 3)
      fireEvent.keyDown(input, { code: 'KeyW', ctrlKey: true })

      fireEvent.change(input, { target: { value: 'abcd' } })

      expect(input.value).toBe('abcd')
      expect(input.selectionStart).toBe(4)
    })
  })

  test('leaves IME-owned events and Cmd+W untouched', () => {
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'abc' } })
      input.setSelectionRange(3, 3)

      const composingEvent = createEvent.keyDown(input, { code: 'KeyW', ctrlKey: true, isComposing: true })
      fireEvent(input, composingEvent)
      const webkitCompositionEvent = createEvent.keyDown(input, { code: 'KeyW', ctrlKey: true, keyCode: 229 })
      fireEvent(input, webkitCompositionEvent)
      fireEvent.keyDown(input, { code: 'KeyW', key: 'w', metaKey: true })

      expect(composingEvent.defaultPrevented).toBe(false)
      expect(webkitCompositionEvent.defaultPrevented).toBe(false)
      expect(input.value).toBe('abc')
    })
  })

  test('leaves history browsing after an accepted editing command', async () => {
    await withNavigatorPlatformAsync('MacIntel', async () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'previous' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await vi.waitFor(() => expect(input.value).toBe(''))
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      expect(input.value).toBe('previous')
      input.setSelectionRange(input.value.length, input.value.length)

      fireEvent.keyDown(input, { code: 'KeyW', key: 'w', ctrlKey: true })
      expect(input.value).toBe('')
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(input.value).toBe('')
    })
  })

  test('leaves non-macOS and mixed-modifier chords untouched', () => {
    withNavigatorPlatform('Win32', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'abc' } })
      input.setSelectionRange(3, 3)
      fireEvent.keyDown(input, { code: 'KeyW', key: 'w', ctrlKey: true })
      expect(input.value).toBe('abc')
    })
    withNavigatorPlatform('MacIntel', () => {
      const { container } = render()
      expand(container)
      showInput(container)
      const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
      fireEvent.change(input, { target: { value: 'abc' } })
      input.setSelectionRange(3, 3)
      fireEvent.keyDown(input, { code: 'KeyW', key: 'w', ctrlKey: true, shiftKey: true })
      expect(input.value).toBe('abc')
    })
  })

  test('does not claim focus when an expanded session shell is restored on mount', () => {
    const { container, rerender } = renderInJsdom(<button type="button">terminal focus owner</button>)
    const focusOwner = buttonByAccessibleName(container, 'terminal focus owner')
    focusOwner.focus()

    rerender(
      <>
        <button type="button">terminal focus owner</button>
        {expandedComposerForTest('session-one')}
      </>,
    )

    expect(document.activeElement).toBe(buttonByAccessibleName(container, 'terminal focus owner'))
  })

  test('uses the session-provided draft when the keyed session changes', () => {
    const { container, rerender } = renderInJsdom(expandedComposerForTest('session-one', ['old command']))
    const firstInput = within(container).getByRole<HTMLTextAreaElement>('textbox', {
      name: LABELS.inputPlaceholder,
    })
    fireEvent.keyDown(firstInput, { key: 'ArrowUp' })
    expect(firstInput.value).toBe('old command')
    fireEvent.change(firstInput, { target: { value: 'session-one draft' } })

    rerender(expandedComposerForTest('session-two', ['other command'], 'session-two draft'))

    const secondInput = within(container).getByRole<HTMLTextAreaElement>('textbox', {
      name: LABELS.inputPlaceholder,
    })
    expect(secondInput).not.toBe(firstInput)
    expect(secondInput.value).toBe('session-two draft')
  })

  test('applies supplied history entries during commit before later layout observers', () => {
    const commitOrder: string[] = []
    const originalUpdateEntries = TerminalComposerHistoryCursor.prototype.updateEntries
    const updateEntries = vi
      .spyOn(TerminalComposerHistoryCursor.prototype, 'updateEntries')
      .mockImplementation(function (this: TerminalComposerHistoryCursor, entries) {
        commitOrder.push('cursor')
        originalUpdateEntries.call(this, entries)
      })

    function LayoutObserver({ historyEntries }: { historyEntries: readonly string[] }) {
      useLayoutEffect(() => {
        commitOrder.push('observer')
      }, [historyEntries])
      return null
    }

    function Harness({ historyEntries }: { historyEntries: readonly string[] }) {
      return (
        <>
          {expandedComposerForTest('session-one', historyEntries)}
          <LayoutObserver historyEntries={historyEntries} />
        </>
      )
    }

    try {
      const { rerender } = renderInJsdom(<Harness historyEntries={['old command']} />)
      commitOrder.length = 0

      rerender(<Harness historyEntries={['new command']} />)

      expect(commitOrder).toEqual(['cursor', 'observer'])
    } finally {
      updateEntries.mockRestore()
    }
  })

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
    const showKeysButton = buttonByAccessibleName(container, LABELS.showKeys)
    const more = buttonByAccessibleName(container, LABELS.more)
    expect(showKeysButton.parentElement).toBe(modeRow)
    expect(more.parentElement).toBe(modeRow)
    expect(more.querySelector('.lucide-ellipsis')).not.toBeNull()
    expect(container.querySelector('.goblin-terminal-composer--expanded')).not.toBeNull()

    openMoreMenu(container)
    act(() => menuItemByText(LABELS.close).click())
    expect(surface?.getAttribute('aria-hidden')).toBe('true')
    expect(surface?.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('textarea')).not.toBeNull()
    await vi.waitFor(() => expect(document.activeElement).toBe(openButton))
  })

  test('opens in input mode even when the retained mode was keys', async () => {
    const user = userEvent.setup()
    const { container } = render()
    const openButton = buttonByAccessibleName(container, LABELS.open)

    await user.click(openButton)

    expect(document.activeElement).toBe(container.querySelector('textarea'))
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  test('moves keyboard focus into input mode when expanded by clicking the trigger', async () => {
    const user = userEvent.setup()
    const { container } = render({ initialMode: 'input' })

    await user.click(buttonByAccessibleName(container, LABELS.open))

    expect(document.activeElement).toBe(container.querySelector('textarea'))
  })

  test('collapses on a physical Escape and restores the trigger focus', async () => {
    const user = userEvent.setup()
    const { container } = render()
    expand(container)

    await user.keyboard('{Escape}')

    const openButton = buttonByAccessibleName(container, LABELS.open)
    expect(openButton.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(openButton)
  })

  test('does not collapse for an IME-owned or virtual Escape', () => {
    const onVirtualKey = vi.fn()
    const { container } = render({ onVirtualKey })
    expand(container)
    act(() => buttonByAccessibleName(container, LABELS.showKeys).click())
    const modeToggle = buttonByAccessibleName(container, LABELS.showInput)
    const composer = container.querySelector('.goblin-terminal-composer')

    fireEvent.keyDown(modeToggle, { key: 'Escape', keyCode: 229 })
    expect(composer?.getAttribute('data-expanded')).toBe('true')

    act(() => buttonByAccessibleName(container, LABELS.escape).click())
    expect(onVirtualKey).toHaveBeenCalledWith('escape')
    expect(composer?.getAttribute('data-expanded')).toBe('true')
  })

  test('submits with Enter and clears only accepted text', async () => {
    const onSendText = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const { container } = render({ onSendText })
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    fireEvent.change(input, { target: { value: 'git status' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendText).toHaveBeenNthCalledWith(1, 'git status')
    await vi.waitFor(() => expect(input.value).toBe('git status'))

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSendText).toHaveBeenNthCalledWith(2, 'git status')
    await vi.waitFor(() => expect(input.value).toBe(''))
  })

  test('does not clear text entered while an earlier draft is being submitted', async () => {
    const submission = Promise.withResolvers<boolean>()
    const { container } = render({ onSendText: vi.fn(() => submission.promise) })
    expand(container)
    showInput(container)
    const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
    fireEvent.change(input, { target: { value: 'submitted draft' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'new draft' } })

    await act(async () => submission.resolve(true))

    expect(input.value).toBe('new draft')
  })

  test('Enter submits while Shift+Enter remains available for text entry', async () => {
    const onSendText = vi.fn(async () => true)
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
    await vi.waitFor(() => expect(input.value).toBe(''))
  })

  test('does not submit the Enter event owned by a Safari IME composition', () => {
    const onSendText = vi.fn(async () => true)
    const { container } = render({ onSendText })
    expand(container)
    showInput(container)
    const input = within(container).getByRole('textbox', { name: LABELS.inputPlaceholder })
    fireEvent.change(input, { target: { value: '输入内容' } })

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })

    expect(onSendText).not.toHaveBeenCalled()
  })

  test('keeps mobile text services from rewriting terminal input', () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')

    expect(input.getAttribute('autocapitalize')).toBe('off')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('enterkeyhint')).toBe('send')
    expect(input.classList.contains('font-mono')).toBe(true)
  })

  test('browses successful submissions with plain vertical arrows only from an empty draft', async () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')

    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(input.value).toBe(''))
    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(input.value).toBe(''))

    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false)
    expect(input.value).toBe('second')
    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false)
    expect(input.value).toBe('first')
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
    expect(input.value).toBe('second')
    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'one\ntwo' } })
    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true)
    expect(input.value).toBe('one\ntwo')
  })

  test('returns vertical arrows to native editing after a recalled entry is changed', async () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')

    fireEvent.change(input, { target: { value: 'previous' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(input.value).toBe(''))
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.change(input, { target: { value: 'previous edited' } })

    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true)
    expect(input.value).toBe('previous edited')
  })

  test('leaves history browsing after an accepted duplicate submission without an entries update', async () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
    fireEvent.change(input, { target: { value: 'previous' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(input.value).toBe(''))
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(input.value).toBe('previous')

    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(input.value).toBe(''))

    expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(true)
  })

  test('does not carry a stale recalled-entry caret into the next draft edit', async () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
    fireEvent.change(input, { target: { value: 'previous' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await vi.waitFor(() => expect(input.value).toBe(''))
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })

    fireEvent.change(input, { target: { value: 'previous edited' } })

    expect(input.selectionStart).toBe('previous edited'.length)
  })

  test('grows with multiline text until the seven-line cap, then leaves overflow to the textarea', () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 196 })

    fireEvent.change(input, { target: { value: 'one\ntwo\nthree\nfour\nfive\nsix' } })

    expect(input.style.height).toBe('160px')
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

  test('maps file insertion through CRLF draft offsets', async () => {
    const resolvedPath = "'/tmp/notes.txt'"
    const onResolveFiles = vi.fn(async () => resolvedPath)
    const { container } = render({ initialDraft: 'cat\r\ndone', onResolveFiles })
    expand(container)
    showInput(container)
    const textarea = container.querySelector('textarea')
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!textarea || !fileInput) throw new Error('expected composer inputs')
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
    textarea.setSelectionRange('cat\n'.length, 'cat\nd'.length)
    openMoreMenu(container)
    act(() => menuItemByText(LABELS.uploadFiles).click())

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })

    expect(textarea.value).toBe(`cat\n${resolvedPath} one`)
    expect(textarea.selectionStart).toBe(`cat\n${resolvedPath}`.length)
  })

  test('keeps one draft edit admitted while selected files resolve', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const resolution = Promise.withResolvers<string | null>()
    const onResolveFiles = vi.fn(() => resolution.promise)
    const onSendText = vi.fn(async () => true)
    const { container } = render({ onResolveFiles, onSendText })
    expand(container)
    showInput(container)
    const textarea = within(container).getByRole<HTMLTextAreaElement>('textbox', { name: LABELS.inputPlaceholder })
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (!fileInput) throw new Error('expected file input')
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(textarea, { target: { value: 'cat ' } })
    textarea.setSelectionRange(4, 4)
    openMoreMenu(container)
    act(() => menuItemByText(LABELS.uploadFiles).click())

    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(textarea.readOnly).toBe(true)
    expect(textarea.getAttribute('aria-busy')).toBe('true')
    const editingEvent = createEvent.keyDown(textarea, { code: 'KeyW', ctrlKey: true })
    fireEvent(textarea, editingEvent)
    expect(editingEvent.defaultPrevented).toBe(true)
    expect(textarea.value).toBe('cat ')
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSendText).not.toHaveBeenCalled()

    await act(async () => resolution.resolve("'/tmp/notes.txt'"))

    expect(textarea.value).toBe("cat '/tmp/notes.txt'")
    expect(textarea.readOnly).toBe(false)
    expect(textarea.hasAttribute('aria-busy')).toBe(false)
  })

  test('sends terminal-mode-aware key intents', () => {
    const onVirtualKey = vi.fn()
    const { container } = render({ onVirtualKey })
    expand(container)
    act(() => buttonByAccessibleName(container, LABELS.showKeys).click())

    expect(container.querySelector('textarea')).toBeNull()
    expect(
      buttonByAccessibleName(container, LABELS.showInput).querySelector('.lucide-text-cursor-input'),
    ).not.toBeNull()
    expect(buttonByAccessibleName(container, LABELS.more).querySelector('.lucide-ellipsis')).not.toBeNull()

    const optionalCommandLabels = [LABELS.backspace, LABELS.escape, LABELS.ctrlL, LABELS.ctrlC, LABELS.ctrlD]
    const pinnedCommandLabels = [LABELS.tab, LABELS.enter]
    const directionLabels = [LABELS.arrowLeft, LABELS.arrowDown, LABELS.arrowUp, LABELS.arrowRight]
    const keyRowLabels = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.goblin-terminal-composer__key-row button'),
    ).map((button) => button.querySelector('.sr-only')?.textContent)
    expect(keyRowLabels).toEqual([...optionalCommandLabels, ...pinnedCommandLabels, ...directionLabels])
    expect(buttonByAccessibleName(container, LABELS.tab).querySelector('.lucide-arrow-right-to-line')).not.toBeNull()
    expect(buttonByAccessibleName(container, LABELS.backspace).querySelector('.lucide-delete')).not.toBeNull()

    for (const name of [...pinnedCommandLabels, ...directionLabels]) {
      act(() => buttonByAccessibleName(container, name).click())
    }
    expect(onVirtualKey.mock.calls.map(([key]) => key)).toEqual([
      'tab',
      'enter',
      'arrow-left',
      'arrow-down',
      'arrow-up',
      'arrow-right',
    ])

    const optionalActions = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[class*="goblin-terminal-composer__key-action--optional-"]'),
    )
    expect(optionalActions.map((button) => button.querySelector('.sr-only')?.textContent)).toEqual(
      optionalCommandLabels,
    )
    for (const button of optionalActions) act(() => button.click())
    expect(onVirtualKey.mock.calls.slice(-5).map(([key]) => key)).toEqual([
      'backspace',
      'escape',
      'clear-screen',
      'interrupt',
      'eof',
    ])

    for (const [label, key] of [
      [LABELS.backspace, 'backspace'],
      [LABELS.escape, 'escape'],
      [LABELS.ctrlL, 'clear-screen'],
      [LABELS.ctrlC, 'interrupt'],
      [LABELS.ctrlD, 'eof'],
    ] as const) {
      const more = buttonByAccessibleName(container, LABELS.more)
      openMoreMenu(container)
      if (key === 'backspace') {
        const menu = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
        if (!menu) throw new Error('expected Composer menu')
        expect(
          Array.from(menu.querySelectorAll('[data-terminal-composer-keycap]')).map((keycap) => keycap.textContent),
        ).toEqual(['Esc', '^L', '^C', '^D'])
        expect(menu.querySelector('.lucide-delete')).not.toBeNull()
        expect(within(menu).queryByRole('button', { name: LABELS.enter })).toBeNull()
        expect(within(menu).queryByRole('button', { name: LABELS.tab })).toBeNull()
        expect(menu.querySelectorAll('[data-slot="separator"]')).toHaveLength(1)
      }
      act(() => menuItemByText(label).click())
      expect(onVirtualKey).toHaveBeenLastCalledWith(key)
      expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
      expect(document.activeElement).toBe(more)
    }
  })

  test('mode toggle preserves the draft and pointer keys preserve composer focus', () => {
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    fireEvent.change(input, { target: { value: 'draft command' } })
    act(() => buttonByAccessibleName(container, LABELS.showKeys).click())
    const arrowUp = buttonByAccessibleName(container, LABELS.arrowUp)
    const modeToggle = buttonByAccessibleName(container, LABELS.showInput)

    expect(fireEvent.pointerDown(arrowUp)).toBe(false)
    act(() => arrowUp.click())
    expect(document.activeElement).toBe(modeToggle)
    fireEvent.click(arrowUp, { detail: 1 })
    expect(document.activeElement).toBe(modeToggle)

    act(() => buttonByAccessibleName(container, LABELS.showInput).click())
    expect(container.querySelector('textarea')?.value).toBe('draft command')
    expect(document.activeElement).toBe(container.querySelector('textarea'))
    expect(buttonByAccessibleName(container, LABELS.more)).toBeTruthy()
    expect(buttonByAccessibleName(container, LABELS.showKeys).querySelector('.lucide-keyboard')).not.toBeNull()
  })

  test('reopens in input mode instead of restoring keys mode', async () => {
    const { container } = render()
    expand(container)
    act(() => buttonByAccessibleName(container, LABELS.showKeys).click())
    openMoreMenu(container)
    act(() => menuItemByText(LABELS.close).click())
    await vi.waitFor(() =>
      expect(buttonByAccessibleName(container, LABELS.open).getAttribute('aria-expanded')).toBe('false'),
    )

    expand(container)

    expect(container.querySelector('textarea')).not.toBeNull()
    expect(buttonByAccessibleName(container, LABELS.showKeys)).toBeTruthy()
  })

  test('does not restore the More trigger over an input explicitly focused while the menu closes', async () => {
    const user = userEvent.setup()
    const { container } = render()
    expand(container)
    showInput(container)
    const input = container.querySelector('textarea')
    if (!input) throw new Error('expected command input')
    openMoreMenu(container)

    await user.click(input)

    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  test('restores the More trigger when the menu is dismissed from the keyboard', async () => {
    const user = userEvent.setup()
    const { container } = render()
    expand(container)
    const more = buttonByAccessibleName(container, LABELS.more)
    openMoreMenu(container)
    expect(document.activeElement).toBe(more)

    await user.keyboard('{Escape}')

    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  test('buttons avoid iOS long-press callout attributes', () => {
    const { container } = render()
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(1)
    for (const button of buttons) {
      expect(button.hasAttribute('title')).toBe(false)
      expect(button.hasAttribute('aria-label')).toBe(false)
      expect(button.querySelector('.sr-only')?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    }
  })
})
