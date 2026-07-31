// @vitest-environment jsdom

import { act, fireEvent, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import {
  clipboardDataWithFiles,
  dropDataWithFiles,
  renderTerminalSession,
} from '#/web/test-utils/terminal-session-view.tsx'

function buttonByLabel(container: HTMLElement, label: string) {
  return within(container).getByRole('button', { name: label })
}

function composerInput(container: HTMLElement) {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="terminal.composer-input-placeholder"]',
  )
  if (!textarea) throw new Error('expected terminal composer input')
  return textarea
}

function openComposerInput(container: HTMLElement) {
  act(() => buttonByLabel(container, 'terminal.composer-open').click())
  return composerInput(container)
}

describe('TerminalSessionView composer', () => {
  test('opens with the exact terminal shortcut, closes search, focuses the control, and collapses on Escape', async () => {
    const user = userEvent.setup()
    const handoffOrder: string[] = []
    const clearSearch = vi.fn(() => handoffOrder.push('clear-search'))
    const rendered = await renderTerminalSession({ clearSearch })

    try {
      const trigger = buttonByLabel(rendered.container, 'terminal.composer-open')
      expect(trigger.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+Enter')
      rendered.sessionRoot.focus()
      await user.keyboard('{Meta>}f{/Meta}')
      expect(rendered.container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      const input = composerInput(rendered.container)
      input.addEventListener('focus', () => handoffOrder.push('composer-focus'))

      const shortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => rendered.sessionRoot.dispatchEvent(shortcut))

      expect(shortcut.defaultPrevented).toBe(true)
      expect(handoffOrder).toEqual(['clear-search', 'composer-focus'])
      expect(clearSearch).toHaveBeenCalledWith('term-111111111111111111111')
      expect(rendered.container.querySelector('.goblin-terminal-session__search')).toBeNull()
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(input)

      await user.keyboard('{Escape}')
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(document.activeElement).toBe(trigger)

      for (const init of [
        { ctrlKey: true, metaKey: true, shiftKey: true },
        { ctrlKey: true, shiftKey: true, altKey: true },
        { ctrlKey: true, shiftKey: true, keyCode: 229 },
      ]) {
        const unsupported = new KeyboardEvent('keydown', {
          key: 'Enter',
          ...init,
          bubbles: true,
          cancelable: true,
        })
        act(() => rendered.sessionRoot.dispatchEvent(unsupported))
        expect(unsupported.defaultPrevented).toBe(false)
      }
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await rendered.cleanup()
    }
  })

  test('uses the macOS Composer shortcut and exposes the matching accessible shortcut', async () => {
    const savedPlatform = navigator.platform
    Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })
    const rendered = await renderTerminalSession()

    try {
      const trigger = buttonByLabel(rendered.container, 'terminal.composer-open')
      expect(trigger.getAttribute('aria-keyshortcuts')).toBe('Meta+Shift+Enter')

      const shortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => rendered.sessionRoot.dispatchEvent(shortcut))

      expect(shortcut.defaultPrevented).toBe(true)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(composerInput(rendered.container))

      const nonMacShortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => rendered.sessionRoot.dispatchEvent(nonMacShortcut))
      expect(nonMacShortcut.defaultPrevented).toBe(false)
    } finally {
      await rendered.cleanup()
      Object.defineProperty(window.navigator, 'platform', { configurable: true, value: savedPlatform })
    }
  })

  test('refocuses an already-expanded Composer instead of toggling it closed', async () => {
    const rendered = await renderTerminalSession()

    try {
      const trigger = buttonByLabel(rendered.container, 'terminal.composer-open')
      act(() => trigger.click())
      rendered.sessionRoot.focus()
      expect(document.activeElement).toBe(rendered.sessionRoot)

      const shortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => rendered.sessionRoot.dispatchEvent(shortcut))

      expect(shortcut.defaultPrevented).toBe(true)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(composerInput(rendered.container))
    } finally {
      await rendered.cleanup()
    }
  })

  test('does not consume the Composer shortcut during presentation recovery', async () => {
    const setComposerExpanded = vi.fn(() => true)
    const rendered = await renderTerminalSession(
      { setComposerExpanded },
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: { expanded: false, mode: 'keys', draft: '', historyEntries: [] },
          attachment: { role: 'controller' },
          presentationRecovery: 'pending',
        },
      },
    )

    try {
      const shortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => rendered.sessionRoot.dispatchEvent(shortcut))

      expect(shortcut.defaultPrevented).toBe(false)
      expect(setComposerExpanded).not.toHaveBeenCalled()
      expect(buttonByLabel(rendered.container, 'terminal.composer-open').getAttribute('aria-expanded')).toBe('false')
    } finally {
      await rendered.cleanup()
    }
  })

  test('does not consume unsupported Composer shortcut variants or viewer input', async () => {
    const setComposerExpanded = vi.fn(() => true)
    const rendered = await renderTerminalSession(
      { setComposerExpanded },
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: { expanded: false, mode: 'keys', draft: '', historyEntries: [] },
          attachment: { role: 'viewer' },
        },
      },
    )

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      act(() => rendered.sessionRoot.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(false)
      expect(setComposerExpanded).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('submits composer text through the selected terminal paste boundary followed by Enter', async () => {
    const submitText = vi.fn(async () => true)
    const rendered = await renderTerminalSession({ submitText })

    try {
      const textarea = openComposerInput(rendered.container)
      fireEvent.change(textarea, { target: { value: 'git status' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(submitText).toHaveBeenCalledWith('term-111111111111111111111', 'git status')
      await vi.waitFor(() => expect(textarea.value).toBe(''))
    } finally {
      await rendered.cleanup()
    }
  })

  test('keeps composer text when the captured session no longer accepts input', async () => {
    const submitText = vi.fn(async () => false)
    const rendered = await renderTerminalSession({ submitText })

    try {
      const textarea = openComposerInput(rendered.container)
      fireEvent.change(textarea, { target: { value: 'keep this command' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(submitText).toHaveBeenCalledWith('term-111111111111111111111', 'keep this command')
      await vi.waitFor(() => expect(textarea.value).toBe('keep this command'))
    } finally {
      await rendered.cleanup()
    }
  })

  test('inserts selected file paths into the composer draft without writing directly to the terminal', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValueOnce('/abs/notes file.txt')
    const rendered = await renderTerminalSession()

    try {
      const textarea = openComposerInput(rendered.container)
      const fileInput = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')
      const moreButton = buttonByLabel(rendered.container, 'terminal.composer-more')
      if (!fileInput) throw new Error('expected composer file controls')
      fireEvent.change(textarea, { target: { value: 'cat ' } })
      textarea.setSelectionRange(4, 4)
      act(() => fireEvent.pointerDown(moreButton, { button: 0, ctrlKey: false }))
      const uploadItem = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-item"]')).find(
        (item) => item.textContent?.includes('terminal.composer-upload-files'),
      )
      if (!uploadItem) throw new Error('expected composer upload action')
      act(() => uploadItem.click())

      fireEvent.change(fileInput, {
        target: { files: [new File(['content'], 'notes.txt', { type: 'text/plain' })] },
      })

      await vi.waitFor(() => expect(textarea.value).toBe("cat '/abs/notes file.txt'"))
      expect(rendered.writeInput).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test.each(['paste', 'drop'] as const)('keeps terminal file %s routed to the PTY over the Composer', async (kind) => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValueOnce('/abs/notes file.txt')
    const rendered = await renderTerminalSession()

    try {
      const textarea = openComposerInput(rendered.container)
      const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
      fireEvent.change(textarea, { target: { value: 'cat ' } })
      textarea.setSelectionRange(4, 4)
      if (kind === 'paste') {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: clipboardDataWithFiles([file]) })
        textarea.dispatchEvent(event)
      } else {
        const terminal = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session')
        if (!terminal) throw new Error('expected terminal session')
        const dataTransfer = dropDataWithFiles([file])
        fireEvent.dragEnter(terminal, { dataTransfer })
        expect(rendered.container.querySelector('.goblin-terminal-session__drop-overlay')).not.toBeNull()
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
        textarea.dispatchEvent(event)
      }

      await vi.waitFor(() =>
        expect(rendered.writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/abs/notes file.txt'"),
      )
      expect(textarea.value).toBe('cat ')
      if (kind === 'drop') {
        expect(rendered.container.querySelector('.goblin-terminal-session__drop-overlay')).toBeNull()
      }
    } finally {
      await rendered.cleanup()
    }
  })

  test('keeps tabular clipboard text on the native Composer paste path when a file is incidental', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    const rendered = await renderTerminalSession()

    try {
      const textarea = openComposerInput(rendered.container)
      const thumbnail = new File(['thumbnail'], 'thumbnail.png', { type: 'image/png' })
      const clipboardData = clipboardDataWithFiles([thumbnail]) as DataTransfer & {
        getData: (format: string) => string
      }
      clipboardData.getData = (format) => (format === 'text/plain' ? 'Name\tValue' : '')
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: clipboardData })

      textarea.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
      expect(rendered.writeInput).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('hides the terminal composer without losing its draft while terminal search is open', async () => {
    const user = userEvent.setup()
    const rendered = await renderTerminalSession()

    try {
      const textarea = openComposerInput(rendered.container)
      fireEvent.change(textarea, { target: { value: 'preserved draft' } })
      await user.keyboard('{Meta>}f{/Meta}')

      expect(rendered.container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(rendered.container.querySelector('.goblin-terminal-composer')?.hasAttribute('hidden')).toBe(true)
      expect(textarea.value).toBe('preserved draft')

      const closeSearch = within(rendered.container).getByRole('button', { name: 'terminal.search-close' })
      act(() => closeSearch.click())

      expect(rendered.container.querySelector('.goblin-terminal-composer')?.hasAttribute('hidden')).toBe(false)
      expect(textarea.value).toBe('preserved draft')
    } finally {
      await rendered.cleanup()
    }
  })
})
