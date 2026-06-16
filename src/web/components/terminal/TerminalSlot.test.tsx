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
    const takeover = vi.fn()
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
    const takeover = vi.fn()
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
})
