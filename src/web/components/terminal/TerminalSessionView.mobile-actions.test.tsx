// @vitest-environment jsdom

import { act, fireEvent } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderTerminalSession } from '#/web/test-utils/terminal-session-view.tsx'

describe('TerminalSessionView mobile actions', () => {
  test('submits composer text and Enter through a writer captured for the selected session', async () => {
    const inputWriter = vi.fn(() => true)
    const captureInputWriter = vi.fn(() => inputWriter)
    const rendered = await renderTerminalSession({ captureInputWriter })

    try {
      const openButton = Array.from(rendered.container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'terminal.composer-open',
      )
      if (!openButton) throw new Error('expected mobile terminal composer button')
      act(() => openButton.click())
      const textarea = rendered.container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="terminal.composer-input-placeholder"]',
      )
      if (!textarea) throw new Error('expected mobile terminal composer input')
      fireEvent.change(textarea, { target: { value: 'git status' } })
      const sendButton = Array.from(rendered.container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'terminal.composer-send',
      )
      if (!sendButton) throw new Error('expected composer send button')
      act(() => sendButton.click())

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
      const openButton = Array.from(rendered.container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'terminal.composer-open',
      )
      if (!openButton) throw new Error('expected mobile terminal composer button')
      act(() => openButton.click())
      const textarea = rendered.container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="terminal.composer-input-placeholder"]',
      )
      if (!textarea) throw new Error('expected mobile terminal composer input')
      fireEvent.change(textarea, { target: { value: 'keep this command' } })
      const sendButton = Array.from(rendered.container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'terminal.composer-send',
      )
      if (!sendButton) throw new Error('expected composer send button')
      act(() => sendButton.click())

      expect(inputWriter).toHaveBeenCalledWith('keep this command\r')
      expect(textarea.value).toBe('keep this command')
    } finally {
      await rendered.cleanup()
    }
  })

  test('hides the terminal composer while terminal search is open on mobile', async () => {
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
