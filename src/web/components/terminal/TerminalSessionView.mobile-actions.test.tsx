// @vitest-environment jsdom

import { act, fireEvent } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import { renderTerminalSession } from '#/web/test-utils/terminal-session-view.tsx'

describe('TerminalSessionView mobile actions', () => {
  test('reads clipboard text through the mobile toolbar and delegates paste to the selected xterm session', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const readText = vi.fn(async () => 'first line\nsecond line')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    const pasteWriter = vi.fn(() => true)
    const capturePasteWriter = vi.fn(() => pasteWriter)
    const rendered = await renderTerminalSession({ capturePasteWriter })

    try {
      const pasteButton = Array.from(rendered.container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'menu.edit.paste',
      )
      if (!pasteButton) throw new Error('expected mobile terminal Paste button')
      await act(async () => {
        pasteButton.click()
        await flushMicrotasks(2)
      })

      expect(readText).toHaveBeenCalledOnce()
      expect(capturePasteWriter).toHaveBeenCalledWith('term-111111111111111111111')
      expect(pasteWriter).toHaveBeenCalledWith('first line\nsecond line')
    } finally {
      await rendered.cleanup()
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  test('offers manual text entry on an insecure LAN origin without losing text for an expired target', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const secureContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
    const readText = vi.fn(async () => 'must not be read')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
    const expiredPasteWriter = vi.fn(() => false)
    const currentPasteWriter = vi.fn(() => true)
    const capturePasteWriter = vi.fn().mockReturnValueOnce(expiredPasteWriter).mockReturnValueOnce(currentPasteWriter)
    const rendered = await renderTerminalSession({ capturePasteWriter })

    try {
      const pasteButton = Array.from(rendered.container.querySelectorAll('button')).find(
        (button) => button.querySelector('.sr-only')?.textContent === 'menu.edit.paste',
      )
      if (!pasteButton) throw new Error('expected mobile terminal Paste button')
      act(() => pasteButton.click())

      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="terminal.mobile-paste-placeholder"]',
      )
      if (!textarea) throw new Error('expected manual paste textarea')
      fireEvent.change(textarea, { target: { value: 'manual paste text' } })
      const submit = document.querySelector<HTMLButtonElement>('[data-slot="dialog-content"] button[type="submit"]')
      if (!submit) throw new Error('expected manual paste submit button')
      act(() => submit.click())

      expect(readText).not.toHaveBeenCalled()
      expect(expiredPasteWriter).toHaveBeenCalledWith('manual paste text')
      expect(textarea.value).toBe('manual paste text')
      expect(document.body.contains(textarea)).toBe(true)

      const cancel = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-content"] button'),
      ).find((button) => button.textContent === 'dialog.cancel')
      if (!cancel) throw new Error('expected manual paste cancel button')
      act(() => cancel.click())
      act(() => pasteButton.click())

      const currentTextarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="terminal.mobile-paste-placeholder"]',
      )
      if (!currentTextarea) throw new Error('expected current manual paste textarea')
      fireEvent.change(currentTextarea, { target: { value: 'current paste text' } })
      const currentSubmit = document.querySelector<HTMLButtonElement>(
        '[data-slot="dialog-content"] button[type="submit"]',
      )
      if (!currentSubmit) throw new Error('expected current manual paste submit button')
      act(() => currentSubmit.click())

      expect(currentPasteWriter).toHaveBeenCalledWith('current paste text')
      expect(document.querySelector('textarea[aria-label="terminal.mobile-paste-placeholder"]')).toBeNull()
    } finally {
      await rendered.cleanup()
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
      if (secureContextDescriptor) Object.defineProperty(globalThis, 'isSecureContext', secureContextDescriptor)
      else Reflect.deleteProperty(globalThis, 'isSecureContext')
    }
  })

  test('hides the mobile toolbar while terminal search is open', async () => {
    const user = userEvent.setup()
    const rendered = await renderTerminalSession()

    try {
      expect(rendered.container.querySelector('.goblin-terminal-mobile-toolbar')).not.toBeNull()
      rendered.sessionRoot.focus()
      await user.keyboard('{Meta>}f{/Meta}')

      expect(rendered.container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(rendered.container.querySelector('.goblin-terminal-mobile-toolbar')).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })
})
