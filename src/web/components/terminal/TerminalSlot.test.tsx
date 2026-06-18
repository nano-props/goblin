// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TerminalSlot } from '#/web/components/terminal/TerminalSlot.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionContextValue, TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

vi.mock('#/web/app-shell-client.ts', () => ({
  pathForDroppedFile: vi.fn(() => ''),
  saveClipboardFiles: vi.fn(() => Promise.resolve([])),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

vi.mock('#/web/components/terminal/mobile-detection.ts', () => ({
  isMobileDevice: () => true,
}))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TerminalSlot', () => {
  test('renders mirror attach banner and triggers takeover', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const takeover = vi.fn().mockResolvedValue(true)
    const summaries = [
      {
        key: 'terminal-1',
        worktreeTerminalKey: '/repo\0/worktree',
        terminalId: 'terminal-1',
        index: 1,
        title: 'zsh',
        phase: 'open' as const,
        selected: true,
        hasBell: false,
      },
    ]
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: summaries,
      count: 1,
      pendingCreate: false,
    }
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'viewer' as const,
        controllerStatus: 'connected' as const,
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
      takeover,
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    await act(async () => {
      root.render(
        <TerminalSessionContext.Provider value={context}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    try {
      expect(container.textContent).toContain('terminal.mirror-controlled')
      const host = container.querySelector('.goblin-terminal-slot__host')
      expect(host?.getAttribute('aria-readonly')).toBe('true')
      expect(container.querySelector('.goblin-terminal-slot__viewer-overlay')).toBeTruthy()
      const button = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.takeover',
      )
      expect(button).toBeDefined()

      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(takeover).toHaveBeenCalledWith('terminal-1')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('does not automatically create a default terminal from render lifecycle', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const emptyWorktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      pendingCreate: false,
    }
    const emptySnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
    const context: TerminalSessionContextValue = {
      createTerminal: vi.fn(async () => 'terminal-2'),
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => emptyWorktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => emptySnapshot,
      subscribeSnapshot: () => () => {},
    }

    await act(async () => {
      root.render(
        <TerminalSessionContext.Provider value={context}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    try {
      expect(container.querySelector('.goblin-terminal-slot__empty')).toBeNull()
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('error phase as a viewer shows the takeover path, not the restart button', async () => {
    // Regression for the previous two-flag gating where a viewer in
    // error phase would see neither the viewer overlay (open-gated)
    // nor the correctly-gated error chip, leaving the dead restart
    // button visible.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const takeover = vi.fn().mockResolvedValue(true)
    const restart = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'error' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const snapshot = {
      phase: 'error' as const,
      message: 'pty crashed',
      processName: 'zsh',
      attachment: {
        role: 'viewer' as const,
        controllerStatus: 'connected' as const,
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'error' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart,
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
      takeover,
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    await act(async () => {
      root.render(
        <TerminalSessionContext.Provider value={context}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    try {
      // Viewer overlay is the primary affordance, with a takeover
      // button that the user must click before they can restart.
      expect(container.querySelector('.goblin-terminal-slot__viewer-overlay')).toBeTruthy()
      const takeoverButton = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.takeover',
      )
      expect(takeoverButton).toBeDefined()

      // The error chip with its restart button must NOT render for
      // a viewer — that button would silently no-op on the server.
      const errorChips = container.querySelectorAll('.goblin-terminal-slot__status-overlay--error')
      expect(errorChips).toHaveLength(0)
      const restartButton = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.restart',
      )
      expect(restartButton).toBeUndefined()

      // The xterm host is still marked readonly so the underlying
      // a11y tree reflects the role.
      const host = container.querySelector('.goblin-terminal-slot__host')
      expect(host?.getAttribute('aria-readonly')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('drop on a viewer slot is ignored (isController gate matches paste)', async () => {
    // Regression for the previous drop handler that only checked `!key`.
    // A viewer dropping a file would silently route input into the
    // controller's PTY; the isController gate added alongside paste
    // closes that hole.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    // Viewer attachment: the !isController branch of handleDrop should
    // short-circuit before touching writeInput.
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'viewer' as const,
        controllerStatus: 'connected' as const,
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    await act(async () => {
      root.render(
        <TerminalSessionContext.Provider value={context}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    try {
      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      expect(slotRoot).toBeTruthy()
      // Synthesize a Drop event with one file. jsdom's DataTransfer
      // doesn't accept programmatic `files` assignment cleanly, so we
      // build a minimal proxy that satisfies the handler.
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png')
      const dataTransfer = {
        types: ['Files'],
        files: [file] as unknown as FileList,
        dropEffect: '',
      } as unknown as DataTransfer
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await act(async () => {
        slotRoot.dispatchEvent(dropEvent)
        // give the resolver microtask chain a tick — even though we
        // expect it never to run.
        await Promise.resolve()
      })
      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('drop on a controller slot writes shell-escaped paths to the PTY', async () => {
    // Happy-path companion to the viewer-rejection test above. Locks
    // the contract: a controller drop that resolves to a path
    // (Electron path-attempt tier) calls writeInput with the
    // shell-escaped path; a controller drop with no path falls
    // through to the blob-save tier. Without this test, the
    // resolver wiring inside TerminalSlot only had negative
    // coverage — a regression that swapped the two paths or
    // dropped the controller gate would have slipped through.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    // Controller attachment — the `isController` branch of handleDrop
    // must NOT short-circuit.
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    // Stub the bridge surface for this test only. The default mock
    // returns '' / [], which would route every file through the
    // blob-save backend and ultimately write nothing. We override
    // to drive the path-attempt tier and assert the resulting
    // shell-escaped writeInput call.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation(
      (file: File) => `/resolved/${file.name}`,
    )
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    try {
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })

      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      expect(slotRoot).toBeTruthy()
      const file = new File([new Uint8Array([1, 2, 3])], "shot with space.png", { type: 'image/png' })
      const dataTransfer = {
        types: ['Files'],
        files: [file] as unknown as FileList,
        dropEffect: '',
      } as unknown as DataTransfer
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await act(async () => {
        slotRoot.dispatchEvent(dropEvent)
        // processDrop -> resolvePastedFiles -> setTimeout-free, but
        // the handler awaits a Promise chain. Let it drain.
        await new Promise((r) => setTimeout(r, 0))
      })

      // One writeInput call with a shell-escaped path. The path
      // contains a space, so shellEscapePath wraps it in single
      // quotes — if the escape regresses to plain concat this
      // assertion catches it.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('terminal-1', "'/resolved/shot with space.png'")
      // The path-attempt tier succeeded, so the blob-save backend
      // was never consulted.
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('paste on a viewer slot is ignored (isController gate)', async () => {
    // Companion to the viewer-drop rejection test. The paste handler
    // runs in capture phase on the slot root (`onPasteCapture`); xterm
    // renders inside the root, so DOM dispatch order beats xterm and
    // we don't need any extra `stopPropagation`. This test locks the
    // controller gate for paste the same way the drop test does.
    //
    // jsdom does not implement ClipboardEvent, so we synthesise one:
    // a plain Event with `clipboardData` grafted on via defineProperty,
    // bubbling so it reaches the slot's React listener. We only need
    // a `files`-like accessor for the paste handler's happy/early-exit
    // paths.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'viewer' as const,
        controllerStatus: 'connected' as const,
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    try {
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })
      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png')
      const clipboardData = {
        files: {
          length: 1,
          item: (i: number) => [file][i] ?? null,
        } as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
      } as unknown as DataTransfer
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
      await act(async () => {
        slotRoot.dispatchEvent(pasteEvent)
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('paste on a controller slot writes shell-escaped paths to the PTY (files branch)', async () => {
    // Happy-path paste test. Mirrors the controller drop test but
    // exercises the capture-phase handler on `clipboardData.files`.
    // The path-attempt tier returns a real path; the blob-save tier
    // is never reached; writeInput gets the shell-escaped path.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation(
      (file: File) => `/resolved/${file.name}`,
    )
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    try {
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })

      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      const file = new File([new Uint8Array([1, 2, 3])], "weird name & space.png")
      const clipboardData = {
        files: {
          length: 1,
          item: (i: number) => [file][i] ?? null,
        } as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
      } as unknown as DataTransfer
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })

      await act(async () => {
        slotRoot.dispatchEvent(pasteEvent)
        await new Promise((r) => setTimeout(r, 0))
      })

      // One writeInput call. The path contains a space and an `&`,
      // both of which `shellEscapePath` wraps in single quotes — if
      // the escape regresses to plain concat this catches it.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith(
        'terminal-1',
        "'/resolved/weird name & space.png'",
      )
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('paste with oversized file triggers paste-file-too-large and prevents xterm fallback', async () => {
    // The handler must call preventDefault() synchronously when it
    // sees an oversized file, so xterm doesn't also try to paste
    // the oversized clipboard data. We assert on `defaultPrevented`
    // after the synchronous dispatch (processPaste is async but
    // the size check runs first and returns).
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const shellClient = await import('#/web/app-shell-client.ts')
    const oversized = new File(
      [new Uint8Array(11 * 1024 * 1024)],
      'huge.bin',
      { type: 'application/octet-stream' },
    )
    // size is settable on File in jsdom (the constructor doesn't
    // refuse it), but read it from the object to keep the assertion
    // in sync with the constant.
    expect(oversized.size).toBeGreaterThan(10 * 1024 * 1024)

    try {
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })

      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      const clipboardData = {
        files: {
          length: 1,
          item: (i: number) => [oversized][i] ?? null,
        } as unknown as FileList,
        items: [] as unknown as DataTransferItemList,
      } as unknown as DataTransfer
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
      await act(async () => {
        slotRoot.dispatchEvent(pasteEvent)
        await new Promise((r) => setTimeout(r, 0))
      })
      // The synchronous size check called preventDefault() before
      // returning; the resolver never ran, so neither did the
      // bridge. writeInput is also untouched.
      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('controller drop with partial backend failure writes the resolved paths AND surfaces paste-file-partial', async () => {
    // Locks the toast-mapping contract from §9 of the design doc:
    // a multi-file paste where path-attempt succeeded for some and
    // blob-save succeeded for fewer than the remaining inputs must
    // (a) write the resolved paths to the PTY and (b) toast a
    // paste-file-partial so the user notices the silent loss. The
    // resolver counts failed correctly (resolver.test.ts), but
    // without this integration test nothing pinned the slot's
    // writeResolutionToPty wiring.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptor = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const worktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => worktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    // 3 files: a has a path (path-attempt tier), b/c have no path
    // and go to the blob-save tier. Backend returns 1 path (only b
    // made it) so 1 file is "failed".
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) =>
      file.name === 'a.png' ? '/abs/a.png' : '',
    )
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue(['/tmp/b.png'])
    const { toast } = await import('sonner')

    try {
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })
      vi.mocked(toast.error).mockClear()

      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      const files = [
        new File([new Uint8Array([1])], 'a.png'),
        new File([new Uint8Array([1])], 'b.png'),
        new File([new Uint8Array([1])], 'c.png'),
      ]
      const dataTransfer = {
        types: ['Files'],
        files: files as unknown as FileList,
        dropEffect: '',
      } as unknown as DataTransfer
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await act(async () => {
        slotRoot.dispatchEvent(dropEvent)
        await new Promise((r) => setTimeout(r, 0))
      })

      // writeInput must receive the joined, shell-escaped paths in
      // the order the resolver returns them (path-attempt tier first,
      // then blob-save). paste-file-partial toasts once.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('terminal-1', '/abs/a.png /tmp/b.png')
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-partial')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('drop resolves with the write dropped if the worktree key changed during resolve', async () => {
    // Locks the worktree-switch guard added on top of the basic
    // controller-drop path. The blob-save tier is a real roundtrip
    // (HTTP POST in web, IPC in Electron), so the user has a real
    // window to switch worktrees before the resolver returns. The
    // captured `sessionKey` would otherwise be typed into a session
    // the user is no longer looking at — invisible to them, or worse,
    // into a now-detached session that the registry silently drops.
    // The fix: capture `key` at handler invocation time, compare to
    // a `keyRef` updated by useEffect on every render, and bail if
    // they diverge.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const writeInput = vi.fn()
    const descriptorA = {
      key: 'terminal-1',
      worktreeTerminalKey: '/repo\0/worktree',
      terminalId: 'terminal-1',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree',
    }
    const descriptorB = {
      key: 'terminal-2',
      worktreeTerminalKey: '/repo\0/worktree-other',
      terminalId: 'terminal-2',
      index: 1,
      repoRoot: '/repo',
      branch: 'feature',
      worktreePath: '/worktree-other',
    }
    const worktreeSnapshotA = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: descriptorA,
      sessions: [
        {
          key: 'terminal-1',
          worktreeTerminalKey: '/repo\0/worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const worktreeSnapshotB = {
      worktreeTerminalKey: '/repo\0/worktree-other',
      selectedDescriptor: descriptorB,
      sessions: [
        {
          key: 'terminal-2',
          worktreeTerminalKey: '/repo\0/worktree-other',
          terminalId: 'terminal-2',
          index: 1,
          title: 'zsh',
          phase: 'open' as const,
          selected: true,
          hasBell: false,
        },
      ],
      count: 1,
      pendingCreate: false,
    }
    const snapshotOpen = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = {
      createTerminal: async () => 'terminal-1',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    let activeWorktreeSnapshot = worktreeSnapshotA
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => activeWorktreeSnapshot,
      subscribeWorktree: () => () => {},
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
      () => new Promise<string[]>((resolve) => { resolveSave = resolve }),
    )

    try {
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })

      const slotRoot = container.querySelector('.goblin-terminal-slot') as HTMLElement
      const file = new File([new Uint8Array([1])], 'a.png')
      const dataTransfer = {
        types: ['Files'],
        files: [file] as unknown as FileList,
        dropEffect: '',
      } as unknown as DataTransfer
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await act(async () => {
        slotRoot.dispatchEvent(dropEvent)
        // Yield to let the resolver start awaiting the (still-pending)
        // saveClipboardFiles Promise.
        await Promise.resolve()
      })

      // User switches worktrees mid-resolve. The slot re-renders with
      // the new descriptor, which updates `keyRef.current` via the
      // useEffect on `key`.
      activeWorktreeSnapshot = worktreeSnapshotB
      await act(async () => {
        root.render(
          <TerminalSessionContext.Provider value={context}>
            <TerminalSessionReadContext.Provider value={readContext}>
              <TerminalSlot
                repoRoot="/repo"
                branch="feature"
                worktreePath="/worktree-other"
              />
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>,
        )
      })

      // Now resolve the in-flight blob-save call. The post-resolve
      // guard must see the divergence and drop the write — neither
      // key (old nor new) should receive input. The chain runs
      // through several microtask hops (saveClipboardFiles.then →
      // resolvePastedFiles.then → processDrop.then → handler.then);
      // setTimeout(0) is the established pattern in the other
      // integration tests for draining them all in one act.
      await act(async () => {
        resolveSave(['/tmp/a.png'])
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(writeInput).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('empty worktree shows a New terminal CTA that calls createTerminal', async () => {
    // Regression for the "blank screen on first click" symptom: when
    // a worktree has no sessions yet, the slot renders a CTA so the
    // user doesn't see a featureless black box and can discover the
    // affordance without reaching for the per-worktree "+" tab.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const createTerminal = vi.fn(async () => 'terminal-1')
    const emptyWorktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      pendingCreate: false,
    }
    const emptySnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
    const context: TerminalSessionContextValue = {
      createTerminal,
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => emptyWorktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => emptySnapshot,
      subscribeSnapshot: () => () => {},
    }

    await act(async () => {
      root.render(
        <TerminalSessionContext.Provider value={context}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    try {
      // The empty-state CTA is present, with the i18n key as its
      // accessible label and the create button visible.
      const cta = container.querySelector('.goblin-terminal-slot__empty-cta')
      expect(cta).toBeTruthy()
      expect(cta?.getAttribute('aria-label')).toBe('terminal.empty')
      const title = container.querySelector('.goblin-terminal-slot__empty-title')
      expect(title?.textContent).toBe('terminal.empty')
      const button = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.new',
      )
      expect(button).toBeDefined()

      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(createTerminal).toHaveBeenCalledTimes(1)
      expect(createTerminal).toHaveBeenCalledWith({
        repoRoot: '/repo',
        branch: 'feature',
        worktreePath: '/worktree',
      })
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('empty-state CTA failure toasts error.terminal-create-failed', async () => {
    // Locks the failure path of the new empty-state CTA. The create
    // throws (e.g., server rejected with error.terminal-create-failed),
    // and the slot surfaces that to the user via sonner.error so they
    // can retry instead of staring at a still-empty slot.
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const createTerminal = vi.fn(async () => {
      throw new Error('error.terminal-create-failed')
    })
    const { toast } = await import('sonner')
    const emptyWorktreeSnapshot = {
      worktreeTerminalKey: '/repo\0/worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      pendingCreate: false,
    }
    const emptySnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
    const context: TerminalSessionContextValue = {
      createTerminal,
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(() => []),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
      takeover: vi.fn(),
      reorderSessions: vi.fn(async () => true),
      serialize: vi.fn(() => ''),
    }
    const readContext: TerminalSessionReadContextValue = {
      worktreeSnapshot: () => emptyWorktreeSnapshot,
      subscribeWorktree: () => () => {},
      snapshot: () => emptySnapshot,
      subscribeSnapshot: () => () => {},
    }

    await act(async () => {
      root.render(
        <TerminalSessionContext.Provider value={context}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <TerminalSlot repoRoot="/repo" branch="feature" worktreePath="/worktree" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    try {
      vi.mocked(toast.error).mockClear()
      const button = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.new',
      )
      expect(button).toBeDefined()
      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(toast.error).toHaveBeenCalledWith('error.terminal-create-failed')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
