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
  test('projects the keyboard inset onto the shared terminal presentation layer', async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const visualViewport = new EventTarget()
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 800 },
      offsetTop: { configurable: true, value: 0 },
      scale: { configurable: true, value: 1 },
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport })
    const rendered = await renderTerminalSession()

    try {
      const session = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session')
      const presentation = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session__presentation')
      const input = composerInput(rendered.container)
      if (!session || !presentation) throw new Error('expected terminal session presentation layer')
      let containerBottom = 800
      vi.spyOn(session, 'getBoundingClientRect').mockImplementation(() => ({
        bottom: containerBottom,
        height: 800,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }))
      const focus = vi.spyOn(input, 'focus')

      act(() => buttonByLabel(rendered.container, 'terminal.composer-open').click())
      expect(document.activeElement).toBe(input)
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')
      expect(rendered.container.querySelector('.goblin-terminal-session__host')?.parentElement).toBe(presentation)
      expect(rendered.container.querySelector('.goblin-terminal-composer')?.parentElement).toBe(presentation)

      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
      act(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')

      containerBottom = 700
      const scrollAncestor = rendered.sessionRoot.parentElement
      if (!scrollAncestor) throw new Error('expected a session scroll ancestor')
      act(() => scrollAncestor.dispatchEvent(new Event('scroll', { bubbles: false })))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-200px)')

      containerBottom = 800
      Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 100 })
      act(() => visualViewport.dispatchEvent(new Event('scroll')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-200px)')

      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 450 })
      act(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-250px)')
    } finally {
      await rendered.cleanup()
      if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
      else Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  test('activates the shared inset only while the Composer input owns focus', async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const visualViewport = new EventTarget()
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 800 },
      offsetTop: { configurable: true, value: 0 },
      scale: { configurable: true, value: 1 },
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport })
    const rendered = await renderTerminalSession()

    try {
      const session = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session')
      const input = composerInput(rendered.container)
      if (!session) throw new Error('expected terminal session')
      vi.spyOn(session, 'getBoundingClientRect').mockReturnValue({
        bottom: 800,
        height: 800,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })
      const focus = vi.spyOn(input, 'focus')
      const terminalHost = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session__host')
      if (!terminalHost) throw new Error('expected terminal host in the presentation layer')
      const terminalInput = document.createElement('textarea')
      terminalHost.appendChild(terminalInput)

      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
      act(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')
      terminalInput.focus()

      const trigger = buttonByLabel(rendered.container, 'terminal.composer-open')
      expect(fireEvent.pointerDown(trigger, { pointerType: 'touch' })).toBe(true)
      trigger.focus()
      fireEvent.click(trigger)

      expect(document.activeElement).toBe(input)
      expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')

      terminalInput.focus()
      expect(document.activeElement).toBe(terminalInput)
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')

      expect(fireEvent.pointerDown(input, { pointerType: 'touch' })).toBe(true)
      expect(document.activeElement).toBe(terminalInput)
      input.focus()
      expect(document.activeElement).toBe(input)
      expect(focus).toHaveBeenLastCalledWith()
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')

      Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 300 })
      act(() => visualViewport.dispatchEvent(new Event('scroll')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')

      Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 0 })
      act(() => visualViewport.dispatchEvent(new Event('scroll')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')
      await rendered.publishSnapshot({
        phase: 'open',
        message: null,
        processName: 'zsh',
        composer: { expanded: true, mode: 'input', draft: '', historyEntries: [] },
        attachment: { role: 'viewer' },
      })
      expect(rendered.container.querySelector('.goblin-terminal-composer')).toBeNull()
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')
    } finally {
      await rendered.cleanup()
      if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
      else Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  test('leaves pinch zoom browser-owned and restores keyboard projection afterward', async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const visualViewport = new EventTarget()
    Object.defineProperties(visualViewport, {
      height: { configurable: true, value: 500 },
      offsetTop: { configurable: true, value: 0 },
      scale: { configurable: true, value: 1 },
    })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport })
    const rendered = await renderTerminalSession()
    let unmounted = false

    try {
      const session = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session')
      if (!session) throw new Error('expected terminal session')
      const rect = vi.spyOn(session, 'getBoundingClientRect').mockReturnValue({
        bottom: 800,
        height: 800,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })

      openComposerInput(rendered.container)
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')

      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 })
      Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 2 })
      act(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')

      Object.defineProperty(visualViewport, 'scale', { configurable: true, value: 1 })
      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
      act(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('translateY(-300px)')

      rect.mockClear()
      await rendered.cleanup()
      unmounted = true
      expect(session.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('none')
      act(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(rect).not.toHaveBeenCalled()
    } finally {
      if (!unmounted) await rendered.cleanup()
      if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
      else Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  test('uses native focus and pointer behavior when visual viewport APIs are unavailable', async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Reflect.deleteProperty(window, 'visualViewport')
    const rendered = await renderTerminalSession()

    try {
      const composer = rendered.container.querySelector<HTMLElement>('.goblin-terminal-composer--floating')
      if (!composer) throw new Error('expected a floating composer')
      expect(rendered.sessionRoot.style.getPropertyValue('--goblin-terminal-presentation-transform')).toBe('')

      const input = composerInput(rendered.container)
      const focus = vi.spyOn(input, 'focus')
      act(() => buttonByLabel(rendered.container, 'terminal.composer-open').click())
      expect(focus).toHaveBeenLastCalledWith()

      const terminalHost = document.createElement('div')
      terminalHost.className = 'goblin-managed-terminal-host'
      const terminalInput = document.createElement('textarea')
      terminalHost.appendChild(terminalInput)
      rendered.sessionRoot.appendChild(terminalHost)
      terminalInput.focus()
      expect(fireEvent.pointerDown(input, { pointerType: 'touch' })).toBe(true)
    } finally {
      await rendered.cleanup()
      if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
    }
  })

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

  test('hides the Composer and does not consume its shortcut during presentation recovery', async () => {
    const setComposerExpanded = vi.fn(() => true)
    const composerState = { expanded: false, mode: 'input' as const, draft: 'preserved draft', historyEntries: [] }
    const rendered = await renderTerminalSession(
      { setComposerExpanded },
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: composerState,
          attachment: { role: 'controller' },
          presentationRecovery: 'pending',
        },
      },
    )

    try {
      const composerGroup = rendered.container.querySelector<HTMLElement>('.goblin-terminal-composer')
      expect(composerGroup?.hidden).toBe(true)
      expect(within(rendered.container).queryByRole('button', { name: 'terminal.composer-open' })).toBeNull()

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

      await rendered.publishSnapshot({
        phase: 'open',
        message: null,
        processName: 'zsh',
        composer: composerState,
        attachment: { role: 'controller' },
        presentationRecovery: 'failed',
      })
      expect(composerGroup?.hidden).toBe(true)

      await rendered.publishSnapshot({
        phase: 'open',
        message: null,
        processName: 'zsh',
        composer: composerState,
        attachment: { role: 'controller' },
      })
      expect(composerGroup?.hidden).toBe(false)
      expect(buttonByLabel(rendered.container, 'terminal.composer-open').getAttribute('aria-expanded')).toBe('false')
      expect(composerInput(rendered.container).value).toBe('preserved draft')
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
      act(() => fireEvent.click(moreButton))
      const popoverContent = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
      const uploadItem = popoverContent
        ? within(popoverContent).getByRole('button', { name: 'terminal.composer-upload-files' })
        : null
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
        const dropOverlay = rendered.container.querySelector('.goblin-terminal-session__drop-overlay')
        expect(dropOverlay).not.toBeNull()
        expect(dropOverlay?.parentElement).toBe(terminal)
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
