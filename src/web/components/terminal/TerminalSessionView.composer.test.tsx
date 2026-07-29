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

function openComposerInput(container: HTMLElement) {
  act(() => buttonByLabel(container, 'terminal.composer-open').click())
  act(() => buttonByLabel(container, 'terminal.composer-show-input').click())
  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="terminal.composer-input-placeholder"]',
  )
  if (!textarea) throw new Error('expected terminal composer input')
  return textarea
}

describe('TerminalSessionView composer', () => {
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
