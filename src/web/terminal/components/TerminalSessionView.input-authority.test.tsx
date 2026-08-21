// @vitest-environment jsdom

import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import { EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST } from '#/web/test-utils/terminal-snapshot.ts'
import {
  captureInputWriterForTest,
  clipboardDataWithFiles,
  dropDataWithFiles,
  renderTerminalSession,
} from '#/web/test-utils/terminal-session-view.tsx'

const VIEWER_SNAPSHOT = {
  phase: 'open',
  message: null,
  processName: 'zsh',
  composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
  attachment: { role: 'viewer' },
} as const

const CONTROLLER_SNAPSHOT = {
  ...VIEWER_SNAPSHOT,
  attachment: { role: 'controller' },
} as const

describe('TerminalSessionView input authority', () => {
  test('error phase as a viewer is readonly without takeover or restart actions', async () => {
    const view = await renderTerminalSession(
      {},
      {
        snapshot: {
          ...VIEWER_SNAPSHOT,
          phase: 'error',
          message: 'pty crashed',
        },
      },
    )

    try {
      expect(view.container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeNull()
      expect(view.container.textContent).not.toContain('terminal.takeover')
      expect(view.container.querySelectorAll('.goblin-terminal-session__status-overlay--error')).toHaveLength(1)
      expect(view.container.textContent).not.toContain('terminal.restart')
      expect(view.container.querySelector('.goblin-terminal-session__host')?.getAttribute('aria-readonly')).toBe('true')
    } finally {
      await view.cleanup()
    }
  })

  test('drop on a viewer session is ignored', async () => {
    const writeInput = vi.fn()
    const view = await renderTerminalSession(
      { captureInputWriter: captureInputWriterForTest(writeInput) },
      { snapshot: VIEWER_SNAPSHOT },
    )

    try {
      const sessionRoot = view.container.querySelector<HTMLElement>('.goblin-terminal-session')
      if (!sessionRoot) throw new Error('missing terminal session root')
      const dataTransfer = dropDataWithFiles([new File([new Uint8Array([1, 2, 3])], 'shot.png')])
      const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnter, 'dataTransfer', { value: dataTransfer })
      const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await flushTestUpdates(() => {
        sessionRoot.dispatchEvent(dragEnter)
        sessionRoot.dispatchEvent(dragOver)
        sessionRoot.dispatchEvent(dropEvent)
      })

      expect(dragEnter.defaultPrevented).toBe(true)
      expect(dragOver.defaultPrevented).toBe(true)
      expect(dataTransfer.dropEffect).toBe('none')
      expect(view.container.querySelector('.goblin-terminal-session__drop-overlay')).toBeNull()
      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      await view.cleanup()
    }
  })

  test('drop on a controller session writes shell-escaped paths to the PTY', async () => {
    const writeInput = vi.fn()
    const shellClient = await import('#/web/app/shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `/resolved/${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])
    const view = await renderTerminalSession(
      { captureInputWriter: captureInputWriterForTest(writeInput) },
      { snapshot: CONTROLLER_SNAPSHOT },
    )

    try {
      const sessionRoot = view.container.querySelector<HTMLElement>('.goblin-terminal-session')
      if (!sessionRoot) throw new Error('missing terminal session root')
      const file = new File([new Uint8Array([1, 2, 3])], 'shot with space.png', { type: 'image/png' })
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        await waitForNextMacrotask()
      })

      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/resolved/shot with space.png'")
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await view.cleanup()
    }
  })

  test('paste on a viewer session is ignored', async () => {
    const writeInput = vi.fn()
    const view = await renderTerminalSession(
      { captureInputWriter: captureInputWriterForTest(writeInput) },
      { snapshot: VIEWER_SNAPSHOT },
    )

    try {
      const sessionRoot = view.container.querySelector<HTMLElement>('.goblin-terminal-session')
      if (!sessionRoot) throw new Error('missing terminal session root')
      const clipboardData = clipboardDataWithFiles([new File([new Uint8Array([1, 2, 3])], 'shot.png')])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })

      await flushTestUpdates(() => sessionRoot.dispatchEvent(pasteEvent))

      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      await view.cleanup()
    }
  })

  test('paste on a controller session writes shell-escaped paths to the PTY', async () => {
    const writeInput = vi.fn()
    const shellClient = await import('#/web/app/shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `/resolved/${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])
    const view = await renderTerminalSession(
      { captureInputWriter: captureInputWriterForTest(writeInput) },
      { snapshot: CONTROLLER_SNAPSHOT },
    )

    try {
      const sessionRoot = view.container.querySelector<HTMLElement>('.goblin-terminal-session')
      if (!sessionRoot) throw new Error('missing terminal session root')
      const file = new File([new Uint8Array([1, 2, 3])], 'weird name & space.png')
      const clipboardData = clipboardDataWithFiles([file])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })

      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(pasteEvent)
        await waitForNextMacrotask()
      })

      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/resolved/weird name & space.png'")
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await view.cleanup()
    }
  })
})
