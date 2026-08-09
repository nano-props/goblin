// @vitest-environment jsdom

import { fireEvent, within } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import {
  clipboardDataWithFiles,
  dropDataWithFiles,
  renderTerminalSession,
  terminalSessionViewToastForTest,
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

async function openComposerInput(container: HTMLElement): Promise<HTMLTextAreaElement> {
  await flushTestUpdates(() => buttonByLabel(container, 'terminal.composer-open').click())
  return composerInput(container)
}

async function chooseComposerFile(container: HTMLElement, draft: string, file: File): Promise<HTMLTextAreaElement> {
  const textarea = await openComposerInput(container)
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!fileInput) throw new Error('expected composer file controls')
  await fireEvent.update(textarea, draft)
  await fireEvent.change(fileInput, { target: { files: [file] } })
  return textarea
}

async function copyContent(container: HTMLElement): Promise<void> {
  await flushTestUpdates(() => buttonByLabel(container, 'terminal.composer-open').click())
  await flushTestUpdates(() => buttonByLabel(container, 'terminal.composer-show-keys').click())
  await flushTestUpdates(() => buttonByLabel(container, 'terminal.composer-more').click())
  const menu = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
  if (!menu) throw new Error('expected open Composer menu')
  await flushTestUpdates(() => within(menu).getByRole('button', { name: 'terminal.composer-copy-content' }).click())
}

describe('TerminalSessionView composer', () => {
  test('copies the terminal copy text and confirms success', async () => {
    vi.clearAllMocks()
    const writeText = vi.fn(async () => {})
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const readCopyText = vi.fn(() => 'command\nerror')
      const rendered = await renderTerminalSession({ readCopyText })

      await copyContent(rendered.container)
      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('command\nerror')
        expect(terminalSessionViewToastForTest().success).toHaveBeenCalledWith('branch-status.copied')
      })

      expect(readCopyText).toHaveBeenCalledWith('term-111111111111111111111')
      await rendered.cleanup()
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  test('does not overwrite the clipboard when there is no content to copy', async () => {
    vi.clearAllMocks()
    const writeText = vi.fn(async () => {})
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      const rendered = await renderTerminalSession({ readCopyText: vi.fn(() => '') })

      await copyContent(rendered.container)

      expect(writeText).not.toHaveBeenCalled()
      expect(terminalSessionViewToastForTest().error).toHaveBeenCalledWith('terminal.composer-copy-content-empty')
      await rendered.cleanup()
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  test('surfaces clipboard rejection without reporting success', async () => {
    vi.clearAllMocks()
    const error = new Error('Clipboard permission denied')
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(error)) },
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
    try {
      const rendered = await renderTerminalSession({ readCopyText: vi.fn(() => 'output') })

      await copyContent(rendered.container)
      await vi.waitFor(() =>
        expect(terminalSessionViewToastForTest().error).toHaveBeenCalledWith('action.result-error', {
          description: 'NotAllowedError: The request is not allowed',
        }),
      )

      expect(terminalSessionViewToastForTest().success).not.toHaveBeenCalled()
      await rendered.cleanup()
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
      else Reflect.deleteProperty(navigator, 'clipboard')
      if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor)
      else Reflect.deleteProperty(document, 'execCommand')
    }
  })

  test('leaves keyboard reveal to native focus when VisualViewport is available', async () => {
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
      const input = composerInput(rendered.container)
      const focus = vi.spyOn(input, 'focus')

      await flushTestUpdates(() => buttonByLabel(rendered.container, 'terminal.composer-open').click())
      expect(document.activeElement).toBe(input)
      expect(focus).toHaveBeenLastCalledWith()
      expect(rendered.container.querySelector('.goblin-terminal-session__host')?.parentElement).toBe(
        rendered.sessionRoot,
      )
      expect(rendered.container.querySelector('.goblin-terminal-composer')?.parentElement).toBe(rendered.sessionRoot)

      Object.defineProperty(visualViewport, 'height', { configurable: true, value: 500 })
      await flushTestUpdates(() => visualViewport.dispatchEvent(new Event('resize')))
      expect(document.activeElement).toBe(input)
      expect(focus).toHaveBeenCalledOnce()
    } finally {
      await rendered.cleanup()
      if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport)
      else Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  test('uses the same native focus behavior without VisualViewport', async () => {
    const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Reflect.deleteProperty(window, 'visualViewport')
    const rendered = await renderTerminalSession()

    try {
      const composer = rendered.container.querySelector<HTMLElement>('.goblin-terminal-composer--floating')
      if (!composer) throw new Error('expected a floating composer')
      const input = composerInput(rendered.container)
      const focus = vi.spyOn(input, 'focus')
      await flushTestUpdates(() => buttonByLabel(rendered.container, 'terminal.composer-open').click())
      expect(focus).toHaveBeenLastCalledWith()

      const terminalHost = document.createElement('div')
      terminalHost.className = 'goblin-managed-terminal-host'
      const terminalInput = document.createElement('textarea')
      terminalHost.appendChild(terminalInput)
      rendered.sessionRoot.appendChild(terminalHost)
      terminalInput.focus()
      await fireEvent.pointerDown(input, { pointerType: 'touch' })
      expect(document.activeElement).toBe(terminalInput)
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
      handoffOrder.length = 0
      clearSearch.mockClear()
      const input = composerInput(rendered.container)
      input.addEventListener('focus', () => handoffOrder.push('composer-focus'))

      const shortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(shortcut))

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
        await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(unsupported))
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
      await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(shortcut))

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
      await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(nonMacShortcut))
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
      await flushTestUpdates(() => trigger.click())
      rendered.sessionRoot.focus()
      expect(document.activeElement).toBe(rendered.sessionRoot)

      const shortcut = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
      await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(shortcut))

      expect(shortcut.defaultPrevented).toBe(true)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(composerInput(rendered.container))
    } finally {
      await rendered.cleanup()
    }
  })

  test('hides the Composer and does not consume its shortcut during presentation recovery', async () => {
    const openComposer = vi.fn(() => true)
    const composerState = { expanded: false, mode: 'input' as const, draft: 'preserved draft', historyEntries: [] }
    const rendered = await renderTerminalSession(
      { openComposer },
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
      await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(shortcut))

      expect(shortcut.defaultPrevented).toBe(false)
      expect(openComposer).not.toHaveBeenCalled()

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
    const openComposer = vi.fn(() => true)
    const rendered = await renderTerminalSession(
      { openComposer },
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
      await flushTestUpdates(() => rendered.sessionRoot.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(false)
      expect(openComposer).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('submits composer text through the selected terminal paste boundary followed by Enter', async () => {
    const submitText = vi.fn(async () => true)
    const rendered = await renderTerminalSession({ submitText })

    try {
      const textarea = await openComposerInput(rendered.container)
      await fireEvent.update(textarea, 'git status')
      await fireEvent.keyDown(textarea, { key: 'Enter' })

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
      const textarea = await openComposerInput(rendered.container)
      await fireEvent.update(textarea, 'keep this command')
      await fireEvent.keyDown(textarea, { key: 'Enter' })

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
      const textarea = await openComposerInput(rendered.container)
      const fileInput = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')
      const moreButton = buttonByLabel(rendered.container, 'terminal.composer-more')
      if (!fileInput) throw new Error('expected composer file controls')
      await fireEvent.update(textarea, 'cat ')
      textarea.setSelectionRange(4, 4)
      await flushTestUpdates(() => fireEvent.click(moreButton))
      const popoverContent = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
      const uploadItem = popoverContent
        ? within(popoverContent).getByRole('button', { name: 'terminal.composer-upload-files' })
        : null
      if (!uploadItem) throw new Error('expected composer upload action')
      await flushTestUpdates(() => uploadItem.click())

      const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
      Object.defineProperty(file, 'size', { value: PASTE_FILE_MAX_BYTES + 1 })
      await fireEvent.change(fileInput, { target: { files: [file] } })

      await vi.waitFor(() => expect(textarea.value).toBe("cat '/abs/notes file.txt'"))
      expect(rendered.writeInput).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('shows file progress while Composer resolves an uploaded file', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    const savedPaths = Promise.withResolvers<string[]>()
    vi.mocked(shellClient.saveClipboardFiles).mockReturnValueOnce(savedPaths.promise)
    const rendered = await renderTerminalSession()

    try {
      const textarea = await chooseComposerFile(rendered.container, '', new File(['content'], 'notes.txt'))

      await vi.waitFor(() =>
        expect(rendered.container.querySelector('[aria-label="terminal.file-resolution-progress"]')).not.toBeNull(),
      )

      await flushTestUpdates(async () => {
        savedPaths.resolve(['/tmp/notes.txt'])
        await savedPaths.promise
      })

      await vi.waitFor(() => {
        expect(rendered.container.querySelector('[aria-label="terminal.file-resolution-progress"]')).toBeNull()
        expect(textarea.value).toBe("'/tmp/notes.txt'")
      })
      expect(rendered.writeInput).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('keeps the composer draft and reports an oversized uploaded blob', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    const toast = terminalSessionViewToastForTest()
    toast.error.mockClear()
    const rendered = await renderTerminalSession()

    try {
      const file = new File([new Uint8Array([1])], 'archive.bin')
      Object.defineProperty(file, 'size', { value: PASTE_FILE_MAX_BYTES + 1 })
      const textarea = await chooseComposerFile(rendered.container, 'cat ', file)

      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('terminal.paste-file-too-large'))
      expect(textarea.value).toBe('cat ')
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('keeps the composer draft when file upload fails', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockRejectedValue(new Error('network down'))
    const toast = terminalSessionViewToastForTest()
    toast.error.mockClear()
    const rendered = await renderTerminalSession()

    try {
      const textarea = await chooseComposerFile(
        rendered.container,
        'cat existing.txt',
        new File(['content'], 'notes.txt'),
      )

      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('terminal.paste-file-failed'))
      expect(textarea.value).toBe('cat existing.txt')
    } finally {
      await rendered.cleanup()
    }
  })

  test('does not offer file upload for a remote terminal', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockClear()
    vi.mocked(shellClient.saveClipboardFiles).mockClear()
    const toast = terminalSessionViewToastForTest()
    toast.error.mockClear()
    const rendered = await renderTerminalSession(
      {},
      {
        repoRoot: 'goblin+ssh://example/srv/repo',
        worktreePath: 'goblin+ssh://example/srv/repo-feature',
      },
    )

    try {
      const textarea = await openComposerInput(rendered.container)
      await fireEvent.update(textarea, 'cat existing.txt')
      await flushTestUpdates(() => buttonByLabel(rendered.container, 'terminal.composer-more').click())
      const menu = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
      if (!menu) throw new Error('expected open Composer menu')

      expect(within(menu).queryByRole('button', { name: 'terminal.composer-upload-files' })).toBeNull()
      expect(rendered.container.querySelector('input[type="file"]')).toBeNull()
      expect(textarea.value).toBe('cat existing.txt')
      expect(toast.error).not.toHaveBeenCalled()
      expect(shellClient.pathForDroppedFile).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test.each(['paste', 'drop'] as const)('keeps terminal file %s routed to the PTY over the Composer', async (kind) => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValueOnce('/abs/notes file.txt')
    const rendered = await renderTerminalSession()

    try {
      const textarea = await openComposerInput(rendered.container)
      const file = new File(['content'], 'notes.txt', { type: 'text/plain' })
      Object.defineProperty(file, 'size', { value: PASTE_FILE_MAX_BYTES + 1 })
      await fireEvent.update(textarea, 'cat ')
      textarea.setSelectionRange(4, 4)
      if (kind === 'paste') {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: clipboardDataWithFiles([file]) })
        textarea.dispatchEvent(event)
      } else {
        const terminal = rendered.container.querySelector<HTMLElement>('.goblin-terminal-session')
        if (!terminal) throw new Error('expected terminal session')
        const dataTransfer = dropDataWithFiles([file])
        await fireEvent.dragEnter(terminal, { dataTransfer })
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
      const textarea = await openComposerInput(rendered.container)
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
      const textarea = await openComposerInput(rendered.container)
      await fireEvent.update(textarea, 'preserved draft')
      await user.keyboard('{Meta>}f{/Meta}')

      expect(rendered.container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(rendered.container.querySelector('.goblin-terminal-composer')?.hasAttribute('hidden')).toBe(true)
      expect(textarea.value).toBe('preserved draft')

      const closeSearch = within(rendered.container).getByRole('button', { name: 'terminal.search-close' })
      await flushTestUpdates(() => closeSearch.click())

      expect(rendered.container.querySelector('.goblin-terminal-composer')?.hasAttribute('hidden')).toBe(false)
      expect(textarea.value).toBe('preserved draft')
    } finally {
      await rendered.cleanup()
    }
  })
})
