// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST } from '#/web/test-utils/terminal-snapshot.ts'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import {
  TerminalSessionView,
  captureInputWriterForTest,
  clipboardDataWithFiles,
  completeFilesystemTargetSnapshot,
  dropDataWithFiles,
  terminalDescriptorTargetForTest,
} from '#/web/test-utils/terminal-session-view.tsx'

describe('TerminalSessionView input authority', () => {
  test('error phase as a viewer is readonly without impossible takeover or restart actions', async () => {
    const takeover = vi.fn().mockResolvedValue(true)
    const restart = vi.fn()
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
          phase: 'error' as const,
          selected: true,
          hasBell: false,
          hasRecentOutput: false,
        },
      ],
      count: 1,
      createPending: false,
    }
    const snapshot = {
      phase: 'error' as const,
      message: 'pty crashed',
      processName: 'zsh',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
      attachment: {
        role: 'viewer' as const,
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
      restart,
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      takeover,
      focusTerminal: vi.fn(),
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const { container, unmount } = renderInJsdom(
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
      expect(container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeNull()
      const takeoverButton = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.takeover',
      )
      expect(takeoverButton).toBeUndefined()

      const errorChips = container.querySelectorAll('.goblin-terminal-session__status-overlay--error')
      expect(errorChips).toHaveLength(1)
      const restartButton = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.restart',
      )
      expect(restartButton).toBeUndefined()

      // The xterm host is still marked readonly so the underlying
      // a11y tree reflects the role.
      const host = container.querySelector('.goblin-terminal-session__host')
      expect(host?.getAttribute('aria-readonly')).toBe('true')
    } finally {
      unmount()
    }
  })

  test('drop on a viewer session is ignored (isController gate matches paste)', async () => {
    // Regression for the previous drop handler that only checked `!terminalSessionId`.
    // A viewer dropping a file would silently route input into the
    // controller's PTY; the isController gate added alongside paste
    // closes that hole.
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
    // Viewer attachment: the !isController branch of handleDrop should
    // short-circuit before touching writeInput.
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
      attachment: {
        role: 'viewer' as const,
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
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const { container, unmount } = renderInJsdom(
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
      expect(sessionRoot).toBeTruthy()
      // Synthesize a Drop event with one file. jsdom's DataTransfer
      // doesn't accept programmatic `files` assignment cleanly, so we
      // build a minimal proxy that satisfies the handler.
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png')
      const dataTransfer = dropDataWithFiles([file])
      const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true })
      Object.defineProperty(dragEnter, 'dataTransfer', { value: dataTransfer })
      const dragOver = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer })
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(dragEnter)
        sessionRoot.dispatchEvent(dragOver)
        sessionRoot.dispatchEvent(dropEvent)
        // give the resolver microtask chain a tick — even though we
        // expect it never to run.
        await Promise.resolve()
      })
      expect(dragEnter.defaultPrevented).toBe(true)
      expect(dragOver.defaultPrevented).toBe(true)
      expect(dataTransfer.dropEffect).toBe('none')
      expect(container.querySelector('.goblin-terminal-session__drop-overlay')).toBeNull()
      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  test('drop on a controller session writes shell-escaped paths to the PTY', async () => {
    // Happy-path companion to the viewer-rejection test above. Locks
    // the contract: a controller drop that resolves to a path
    // (Electron path-attempt tier) calls writeInput with the
    // shell-escaped path; a controller drop with no path falls
    // through to the blob-save tier. Without this test, the
    // resolver wiring inside TerminalSessionView only had negative
    // coverage — a regression that swapped the two paths or
    // dropped the controller gate would have slipped through.
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
    // Controller attachment — the `isController` branch of handleDrop
    // must NOT short-circuit.
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
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    // Stub the bridge surface for this test only. The default mock
    // returns '' / [], which would route every file through the
    // blob-save backend and ultimately write nothing. We override
    // to drive the path-attempt tier and assert the resulting
    // shell-escaped writeInput call.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `/resolved/${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const { container, unmount } = renderInJsdom(
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
      expect(sessionRoot).toBeTruthy()
      const file = new File([new Uint8Array([1, 2, 3])], 'shot with space.png', { type: 'image/png' })
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        // processDrop -> resolvePastedFiles -> setTimeout-free, but
        // the handler awaits a Promise chain. Let it drain.
        await waitForNextMacrotask()
      })

      // One writeInput call with a shell-escaped path. The path
      // contains a space, so shellEscapePath wraps it in single
      // quotes — if the escape regresses to plain concat this
      // assertion catches it.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/resolved/shot with space.png'")
      // The path-attempt tier succeeded, so the blob-save backend
      // was never consulted.
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  test('paste on a viewer session is ignored (isController gate)', async () => {
    // Companion to the viewer-drop rejection test. The paste handler
    // runs in capture phase on the session root (`onPasteCapture`); xterm
    // renders inside the root, so DOM dispatch order beats xterm and
    // we don't need any extra `stopPropagation`. This test locks the
    // controller gate for paste the same way the drop test does.
    //
    // jsdom does not implement ClipboardEvent, so we synthesise one:
    // a plain Event with `clipboardData` grafted on via defineProperty,
    // bubbling so it reaches the session's DOM listener. We only need
    // a `files`-like accessor for the paste handler's happy/early-exit
    // paths.
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
        role: 'viewer' as const,
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
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const { container, unmount } = renderInJsdom(
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
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png')
      const clipboardData = clipboardDataWithFiles([file])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(pasteEvent)
        await waitForNextMacrotask()
      })
      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  test('paste on a controller session writes shell-escaped paths to the PTY (files branch)', async () => {
    // Happy-path paste test. Mirrors the controller drop test but
    // exercises the capture-phase handler on `clipboardData.files`.
    // The path-attempt tier returns a real path; the blob-save tier
    // is never reached; writeInput gets the shell-escaped path.
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
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      workspaceTerminalSessions: () => [],
      subscribeWorkspaceTerminalSessions: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `/resolved/${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const { container, unmount } = renderInJsdom(
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
      const file = new File([new Uint8Array([1, 2, 3])], 'weird name & space.png')
      const clipboardData = clipboardDataWithFiles([file])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })

      await flushTestUpdates(async () => {
        sessionRoot.dispatchEvent(pasteEvent)
        await waitForNextMacrotask()
      })

      // One writeInput call. The path contains a space and an `&`,
      // both of which `shellEscapePath` wraps in single quotes — if
      // the escape regresses to plain concat this catches it.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/resolved/weird name & space.png'")
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})
