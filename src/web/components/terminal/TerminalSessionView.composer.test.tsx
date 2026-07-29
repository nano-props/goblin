// @vitest-environment jsdom

import { act, fireEvent } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderTerminalSession } from '#/web/test-utils/terminal-session-view.tsx'

function buttonByLabel(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.querySelector('.sr-only')?.textContent === label,
  )
  if (!button) throw new Error(`expected composer button named ${label}`)
  return button
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
  test('submits composer text and Enter through a writer captured for the selected session', async () => {
    const inputWriter = vi.fn(() => true)
    const captureInputWriter = vi.fn(() => inputWriter)
    const rendered = await renderTerminalSession({ captureInputWriter })

    try {
      const textarea = openComposerInput(rendered.container)
      fireEvent.change(textarea, { target: { value: 'git status' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(captureInputWriter).toHaveBeenCalledWith('term-111111111111111111111')
      expect(inputWriter).toHaveBeenCalledWith('git status\r')
      expect(textarea.value).toBe('')
    } finally {
      await rendered.cleanup()
    }
  })

  test('keeps composer text when the captured session no longer accepts input', async () => {
    const inputWriter = vi.fn(() => false)
    const rendered = await renderTerminalSession({ captureInputWriter: vi.fn(() => inputWriter) })

    try {
      const textarea = openComposerInput(rendered.container)
      fireEvent.change(textarea, { target: { value: 'keep this command' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(inputWriter).toHaveBeenCalledWith('keep this command\r')
      expect(textarea.value).toBe('keep this command')
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

  test('hides the terminal composer while terminal search is open', async () => {
    const user = userEvent.setup()
    const rendered = await renderTerminalSession()

    try {
      expect(rendered.container.querySelector('.goblin-terminal-composer')).not.toBeNull()
      rendered.sessionRoot.focus()
      await user.keyboard('{Meta>}f{/Meta}')

      expect(rendered.container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(rendered.container.querySelector('.goblin-terminal-composer')).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })
})
