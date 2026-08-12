// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import { MAX_PASTE_BATCH_BYTES, MAX_PASTE_UPLOAD_FILES, PASTE_FILE_MAX_BYTES } from '#/shared/clipboard-paste.ts'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST } from '#/web/test-utils/terminal-snapshot.ts'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import { terminalDescriptorForTest } from '#/web/test-utils/terminal-model.ts'
import {
  TerminalSessionView,
  type TestFilesystemTargetSnapshot,
  captureInputWriterForTest,
  clipboardDataWithFiles,
  completeFilesystemTargetSnapshot,
  dispatchPaste,
  dispatchPasteWithText,
  dropDataWithFiles,
  renderTerminalSession,
  terminalDescriptorTargetForTest,
} from '#/web/test-utils/terminal-session-view.tsx'

describe('TerminalSessionView file transfer', () => {
  test('does not revive a stale drop overlay after input authority returns', async () => {
    const rendered = await renderTerminalSession()
    const transfer = dropDataWithFiles([new File(['content'], 'notes.txt')])

    try {
      const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnter, 'dataTransfer', { value: transfer })
      await flushTestUpdates(async () => rendered.sessionRoot.dispatchEvent(dragEnter))
      expect(rendered.container.querySelector('.goblin-terminal-session__drop-overlay')).not.toBeNull()

      const snapshot = {
        phase: 'open' as const,
        message: null,
        processName: 'zsh',
        composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
      }
      await rendered.publishSnapshot({ ...snapshot, attachment: { role: 'viewer' } })
      expect(rendered.container.querySelector('.goblin-terminal-session__drop-overlay')).toBeNull()

      await rendered.publishSnapshot({ ...snapshot, attachment: { role: 'controller' } })
      expect(rendered.container.querySelector('.goblin-terminal-session__drop-overlay')).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste with an oversized blob fails without upload or xterm fallback', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    const oversized = new File([new Uint8Array([1])], 'huge.bin', { type: 'application/octet-stream' })
    Object.defineProperty(oversized, 'size', { value: PASTE_FILE_MAX_BYTES + 1 })
    const rendered = await renderTerminalSession()

    try {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardDataWithFiles([oversized]) })
      await flushTestUpdates(async () => {
        rendered.sessionRoot.dispatchEvent(pasteEvent)
        await waitForNextMacrotask()
      })
      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-too-large')
    } finally {
      await rendered.cleanup()
    }
  })

  test.each([
    ['paste', PASTE_FILE_MAX_BYTES + 1],
    ['drop', 1],
  ] as const)('remote %s rejects files before local resolution or terminal input', async (kind, fileSize) => {
    const shellClient = await import('#/web/app-shell-client.ts')
    const { toast } = await import('vue-sonner')
    vi.mocked(shellClient.pathForDroppedFile).mockClear()
    vi.mocked(shellClient.saveClipboardFiles).mockClear()
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession(
      {},
      {
        repoRoot: 'goblin+ssh://example/srv/repo',
        worktreePath: 'goblin+ssh://example/srv/repo-feature',
      },
    )
    const file = new File([new Uint8Array([1])], 'archive.bin')
    Object.defineProperty(file, 'size', { value: fileSize })

    try {
      const transfer = kind === 'drop' ? dropDataWithFiles([file]) : null
      if (transfer) {
        const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true })
        Object.defineProperty(dragEnter, 'dataTransfer', { value: transfer })
        rendered.sessionRoot.dispatchEvent(dragEnter)
        const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
        Object.defineProperty(dragOver, 'dataTransfer', { value: transfer })
        rendered.sessionRoot.dispatchEvent(dragOver)
        expect(dragEnter.defaultPrevented).toBe(true)
        expect(dragOver.defaultPrevented).toBe(true)
        expect(transfer.dropEffect).toBe('none')
        expect(rendered.container.querySelector('.goblin-terminal-session__drop-overlay')).toBeNull()
      }
      const event = new Event(kind, { bubbles: true, cancelable: true })
      Object.defineProperty(event, kind === 'paste' ? 'clipboardData' : 'dataTransfer', {
        value: kind === 'paste' ? clipboardDataWithFiles([file]) : transfer,
      })
      await flushTestUpdates(async () => {
        rendered.sessionRoot.dispatchEvent(event)
        await waitForNextMacrotask()
      })

      expect(event.defaultPrevented).toBe(true)
      expect(shellClient.pathForDroppedFile).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-remote-unsupported')
    } finally {
      await rendered.cleanup()
    }
  })

  test.each(['paste', 'drop'] as const)('%s reports when the selected terminal cannot accept input', async (kind) => {
    const shellClient = await import('#/web/app-shell-client.ts')
    const { toast } = await import('vue-sonner')
    vi.mocked(shellClient.pathForDroppedFile).mockClear()
    vi.mocked(shellClient.saveClipboardFiles).mockClear()
    vi.mocked(toast.warning).mockClear()
    const rendered = await renderTerminalSession({ captureInputWriter: vi.fn(() => null) })
    const file = new File(['content'], 'notes.txt')

    try {
      if (kind === 'paste') {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: clipboardDataWithFiles([file]) })
        rendered.sessionRoot.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      } else {
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: dropDataWithFiles([file]) })
        rendered.sessionRoot.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
      }

      expect(shellClient.pathForDroppedFile).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith('terminal.write-not-sent')
    } finally {
      await rendered.cleanup()
    }
  })

  test.each(['paste', 'drop'] as const)('%s surfaces a resolver failure without writing', async (kind) => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockRejectedValue(new Error('network down'))
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()
    const file = new File([new Uint8Array([1])], 'foo.png')

    try {
      if (kind === 'paste') await dispatchPaste(rendered.sessionRoot, [file])
      else {
        const event = new Event('drop', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'dataTransfer', { value: dropDataWithFiles([file]) })
        await flushTestUpdates(async () => {
          rendered.sessionRoot.dispatchEvent(event)
          await waitForNextMacrotask()
        })
      }

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      await rendered.cleanup()
    }
  })

  test('keeps file progress visible until concurrent resolutions finish', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    const first = Promise.withResolvers<string[]>()
    const second = Promise.withResolvers<string[]>()
    vi.mocked(shellClient.saveClipboardFiles)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const rendered = await renderTerminalSession()

    try {
      const dispatchPendingPaste = (name: string) => {
        const event = new Event('paste', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', {
          value: clipboardDataWithFiles([new File(['content'], name)]),
        })
        rendered.sessionRoot.dispatchEvent(event)
      }
      await flushTestUpdates(async () => {
        dispatchPendingPaste('first.txt')
        dispatchPendingPaste('second.txt')
        await Promise.resolve()
      })

      const pendingProgress = () => rendered.container.querySelector('[aria-label="terminal.file-resolution-progress"]')
      expect(pendingProgress()).not.toBeNull()

      await flushTestUpdates(async () => {
        first.resolve(['/tmp/first.txt'])
        await waitForNextMacrotask()
      })
      expect(pendingProgress()).not.toBeNull()

      await flushTestUpdates(async () => {
        second.resolve(['/tmp/second.txt'])
        await waitForNextMacrotask()
      })
      expect(pendingProgress()).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })

  test('drop fast-fails an oversized blob batch with the batch limit error', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()
    const first = new File([new Uint8Array([1])], 'first.bin')
    const second = new File([new Uint8Array([1])], 'second.bin')
    Object.defineProperty(first, 'size', { value: MAX_PASTE_BATCH_BYTES / 2 + 1 })
    Object.defineProperty(second, 'size', { value: MAX_PASTE_BATCH_BYTES / 2 })

    try {
      const dataTransfer = dropDataWithFiles([first, second])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await flushTestUpdates(async () => {
        rendered.sessionRoot.dispatchEvent(dropEvent)
        await waitForNextMacrotask()
      })

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-batch-too-large')
    } finally {
      await rendered.cleanup()
    }
  })

  test('drop fast-fails an excessive blob count before upload', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()
    const files = Array.from({ length: MAX_PASTE_UPLOAD_FILES + 1 }, (_, index) => new File([], `empty-${index}.txt`))

    try {
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dropDataWithFiles(files) })
      await flushTestUpdates(async () => {
        rendered.sessionRoot.dispatchEvent(dropEvent)
        await waitForNextMacrotask()
      })

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-too-many')
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste with paths over the terminal envelope surfaces paste-file-overflow', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue(`/abs/${'a'.repeat(1024 * 1024)}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [new File([new Uint8Array([1])], 'huge-path.png')])

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-overflow')
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste rejects the complete path list when a returned path is unsafe', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue(['/tmp/a.png', '/tmp/b\n.png'])
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [
        new File([new Uint8Array([1])], 'a.png'),
        new File([new Uint8Array([1])], 'b.png'),
      ])

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-unsafe')
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste reports when the captured terminal stops accepting input before the write', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('/abs/a.png')
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.warning).mockClear()
    const rendered = await renderTerminalSession({ captureInputWriter: vi.fn(() => () => false) })

    try {
      await dispatchPaste(rendered.sessionRoot, [new File([new Uint8Array([1])], 'a.png')])

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith('terminal.write-not-sent')
    } finally {
      await rendered.cleanup()
    }
  })

  test('drop writes to the terminal session captured by the drop event after a filesystem target switch', async () => {
    // The blob-save tier is a real roundtrip (HTTP POST in web, IPC in
    // Electron), so the user can switch filesystem targets before the resolver returns.
    // The operation target is still the session that received the original
    // drop event; projection/server lifecycle decides whether that session is
    // still writable.
    const writeInput = vi.fn()
    const descriptorA = {
      terminalSessionId: 'term-111111111111111111111',
      terminalFilesystemTargetKey: '/repo\0/worktree',
      index: 1,
      ...terminalDescriptorTargetForTest(),
    }
    const descriptorB = terminalDescriptorForTest({
      terminalSessionId: 'term-222222222222222222222',
      index: 1,

      workspaceRuntimeId: 'repo-runtime-test',
      branch: 'feature',
      worktreePath: '/worktree-other',
      repoRoot: '/repo',
    })
    const filesystemTargetSnapshotA = {
      terminalFilesystemTargetKey: '/repo\0/worktree',
      selectedDescriptor: descriptorA,
      sessions: [
        {
          terminalSessionId: 'term-111111111111111111111',
          terminalFilesystemTargetKey: '/repo\0/worktree',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
          hasRecentOutput: false,
        },
      ],
      count: 1,
      createPending: false,
    }
    const filesystemTargetSnapshotB = {
      terminalFilesystemTargetKey: '/repo\0/worktree-other',
      selectedDescriptor: descriptorB,
      sessions: [
        {
          terminalSessionId: 'term-222222222222222222222',
          terminalFilesystemTargetKey: '/repo\0/worktree-other',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
          hasRecentOutput: false,
        },
      ],
      count: 1,
      createPending: false,
    }
    const snapshotOpen = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
      attachment: {
        role: 'controller' as const,
      },
    }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => ({ kind: 'committed' as const, projection: 'applied' as const })),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      captureInputWriter: captureInputWriterForTest(writeInput),
      takeover: vi.fn(),
      focusTerminal: vi.fn(),
    })
    let activeFilesystemTargetSnapshot: TestFilesystemTargetSnapshot = filesystemTargetSnapshotA
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(activeFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => snapshotOpen,
      subscribeSnapshot: () => () => {},
    }

    // Force the blob-save tier (no path-attempt) and gate the
    // resolution on a Promise we control. The dispatch returns
    // synchronously; the resolver only runs when we call the
    // `resolve` we capture here.
    let resolveSave: (paths: string[]) => void = () => {}
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveSave = resolve
        }),
    )

    const { container, rerender, unmount } = renderInJsdom(
      <TerminalSessionCommandScope value={context}>
        <TerminalSessionReadScope value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
    )

    try {
      const sessionRoot = container.querySelector('.goblin-terminal-session') as HTMLElement
      const file = new File([new Uint8Array([1])], 'a.png')
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        // Yield to let the resolver start awaiting the (still-pending)
        // saveClipboardFiles Promise.
        await Promise.resolve()
      })
      expect(container.querySelector('[aria-label="terminal.file-resolution-progress"]')).not.toBeNull()

      // User switches filesystem targets mid-resolve. The session re-renders with
      // the new descriptor, but the in-flight drop keeps the target captured
      // at the event boundary.
      activeFilesystemTargetSnapshot = filesystemTargetSnapshotB
      await rerender(
        <TerminalSessionCommandScope value={context}>
          <TerminalSessionReadScope value={readContext}>
            <TerminalSessionView
              repoRoot="/repo"
              workspaceRuntimeId={'repo-runtime-test'}
              branch="feature"
              worktreePath="/worktree-other"
            />
          </TerminalSessionReadScope>
        </TerminalSessionCommandScope>,
      )
      expect(container.querySelector('[aria-label="terminal.file-resolution-progress"]')).toBeNull()

      // Now resolve the in-flight blob-save call. The chain runs through
      // several microtask hops (saveClipboardFiles.then →
      // resolvePastedFiles.then → processDrop.then → handler.then);
      // Cross one macrotask so the integration promise chain drains inside
      // the same act boundary as the deferred bridge response.
      await flushTestUpdates(async () => {
        resolveSave(['/tmp/a.png'])
        await waitForNextMacrotask()
      })

      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/tmp/a.png'")
    } finally {
      unmount()
    }
  })

  test('Excel-style paste (text + thumbnail blob) defers to xterm.js (text wins)', async () => {
    // The bug: Excel `Cmd+C` puts TSV on the clipboard along with an
    // incidental image/png thumbnail. The old code unconditionally
    // routed through the file resolver, blob-saved the thumbnail,
    // and wrote `/tmp/.../paste-...png` to the PTY *in addition to*
    // xterm.js writing the TSV synchronously. The user saw both.
    // The fix: when text is recognisably tabular text, drop the file
    // blobs and let xterm.js's native paste handler pick up the text.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()
    const thumbnail = new File([new Uint8Array([1, 2, 3])], 'thumbnail.png', { type: 'image/png' })
    const tsv = 'Header1\tHeader2\tHeader3\nValue1\tValue2\tValue3'

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, tsv, [thumbnail])

      // We deliberately do NOT preventDefault here — xterm.js gets
      // the event and writes the TSV to PTY itself. We must also
      // NOT call writeInput with a path: that was the bug.
      expect(event.defaultPrevented).toBe(false)
      expect(rendered.writeInput).not.toHaveBeenCalled()
      // And critically: the resolver was never consulted, so the
      // thumbnail was never blob-saved (no /tmp write either).
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('Linux file copy (URI-list text + real file) prefers files', async () => {
    // The Linux file copy case the existing comment was trying to
    // preserve: Nautilus etc. emit the URI list both as `text/uri-list`
    // AND as `text/plain`. The text is a redundant rendering of the
    // same URIs already in `Files`. We must still pick the file and
    // let the resolver produce the shell-quoted path.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('/home/user/foo.png')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()
    const file = new File([new Uint8Array([1])], 'foo.png')

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, 'file:///home/user/foo.png', [file])

      expect(event.defaultPrevented).toBe(true)
      expect(rendered.writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/home/user/foo.png'")
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('pure-text paste (no files) does not preventDefault and does not call writeInput', async () => {
    // The session must NOT intercept a text-only paste. xterm.js's native
    // paste handler reads `clipboardData.getData('text/plain')` and
    // writes the text to PTY itself (with bracketed-paste wrap when
    // applicable).
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, 'echo hello', [])
      expect(event.defaultPrevented).toBe(false)
      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })
})
