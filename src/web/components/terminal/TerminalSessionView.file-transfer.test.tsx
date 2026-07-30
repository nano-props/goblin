// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST } from '#/web/test-utils/terminal-snapshot.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
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
  test('paste with oversized file triggers paste-file-too-large and prevents xterm fallback', async () => {
    // The handler must call preventDefault() synchronously when it
    // sees an oversized file, so xterm doesn't also try to paste
    // the oversized clipboard data. We assert on `defaultPrevented`
    // after the synchronous dispatch (the capture handler's size
    // check runs before any async resolver work).
    const writeInput = vi.fn()
    const descriptor = {
      terminalSessionId: 'term-111111111111111111111',
      terminalFilesystemTargetKey: '/repo\0/worktree',
      index: 1,
      ...terminalDescriptorTargetForTest(),
    }
    const terminalFilesystemTargetSnapshot = {
      terminalFilesystemTargetKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
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
    const snapshot = {
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
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
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
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const shellClient = await import('#/web/app-shell-client.ts')
    const oversized = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' })
    // size is settable on File in jsdom (the constructor doesn't
    // refuse it), but read it from the object to keep the assertion
    // in sync with the constant.
    expect(oversized.size).toBeGreaterThan(10 * 1024 * 1024)

    const { container, unmount } = renderInJsdom(
      <TerminalSessionContext value={context}>
        <TerminalSessionReadContext value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    try {
      const sessionRoot = container.querySelector('.goblin-terminal-session') as HTMLElement
      const clipboardData = clipboardDataWithFiles([oversized])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
      await act(async () => {
        sessionRoot.dispatchEvent(pasteEvent)
        await waitForNextMacrotask()
      })
      // The synchronous size check called preventDefault() before
      // returning; the resolver never ran, so neither did the
      // bridge. writeInput is also untouched.
      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  test('paste with backend failure surfaces paste-file-failed without writing', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [new File([new Uint8Array([1])], 'a.png')])

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-failed')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-unsafe')
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste surfaces paste-file-failed when the resolver throws (no silent failure)', async () => {
    // Defensive regression: if `resolvePastedFiles` rejects (IPC
    // channel error, network failure, server 5xx) the session must
    // surface a toast instead of silently dropping the paste. Force
    // the blob-save tier by giving path-attempt a no-path result.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockRejectedValue(new Error('network down'))
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [new File([new Uint8Array([1])], 'foo.png')])

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      await rendered.cleanup()
    }
  })

  test('drop surfaces paste-file-failed when the resolver throws', async () => {
    // Same defensive regression for the drop path.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockRejectedValue(new Error('network down'))
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()
    const file = new File([new Uint8Array([1])], 'foo.png')

    try {
      const sessionRoot = rendered.sessionRoot
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await act(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        await waitForNextMacrotask()
      })

      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste with paths over the terminal envelope surfaces paste-file-overflow', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue(`/abs/${'a'.repeat(1024 * 1024)}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])
    const { toast } = await import('sonner')
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

  test('paste with partial backend failure writes resolved paths and surfaces paste-file-partial', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) =>
      file.name === 'a.png' ? '/abs/a.png' : '',
    )
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue(['/tmp/b.png'])
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [
        new File([new Uint8Array([1])], 'a.png'),
        new File([new Uint8Array([1])], 'b.png'),
        new File([new Uint8Array([1])], 'c.png'),
      ])

      expect(rendered.writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/abs/a.png' '/tmp/b.png'")
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-partial')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-failed')
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
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
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
      <TerminalSessionContext value={context}>
        <TerminalSessionReadContext value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    try {
      const sessionRoot = container.querySelector('.goblin-terminal-session') as HTMLElement
      const file = new File([new Uint8Array([1])], 'a.png')
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await act(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        // Yield to let the resolver start awaiting the (still-pending)
        // saveClipboardFiles Promise.
        await Promise.resolve()
      })

      // User switches filesystem targets mid-resolve. The session re-renders with
      // the new descriptor, but the in-flight drop keeps the target captured
      // at the event boundary.
      activeFilesystemTargetSnapshot = filesystemTargetSnapshotB
      rerender(
        <TerminalSessionContext value={context}>
          <TerminalSessionReadContext value={readContext}>
            <TerminalSessionView
              repoRoot="/repo"
              workspaceRuntimeId={'repo-runtime-test'}
              branch="feature"
              worktreePath="/worktree-other"
            />
          </TerminalSessionReadContext>
        </TerminalSessionContext>,
      )

      // Now resolve the in-flight blob-save call. The chain runs through
      // several microtask hops (saveClipboardFiles.then →
      // resolvePastedFiles.then → processDrop.then → handler.then);
      // Cross one macrotask so the integration promise chain drains inside
      // the same act boundary as the deferred bridge response.
      await act(async () => {
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
