// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalFocusRequest,
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import { claimTerminalAutoFocus, resetTerminalAutoFocusForTest } from '#/web/terminal-focus.ts'
import { beginAppNavigation } from '#/web/app-navigation-lifecycle.ts'
import {
  TerminalSessionView,
  completeFilesystemTargetSnapshot,
  terminalDescriptorTargetForTest,
} from '#/web/test-utils/terminal-session-view.tsx'

describe('TerminalSessionView presentation and focus', () => {
  test('retries precommitted focus after the StrictMode view reaches its stable mount', async () => {
    resetTerminalAutoFocusForTest()
    const descriptor = {
      terminalSessionId: 'term-111111111111111111111',
      terminalFilesystemTargetKey: '/repo\0/worktree',
      index: 1,
      ...terminalDescriptorTargetForTest(),
    }
    const terminalFilesystemTargetSnapshot = completeFilesystemTargetSnapshot({
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
        },
        {
          terminalSessionId: 'term-222222222222222222222',
          terminalFilesystemTargetKey: '/repo\0/worktree',
          index: 2,
          title: 'zsh',
          phase: 'open' as const,
          selected: false,
          hasBell: false,
        },
      ],
      count: 2,
      createPending: false,
    })
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
      },
    }
    let connected = false
    const attach = vi.fn(() => {
      connected = true
    })
    let currentFocusRequest: TerminalFocusRequest | undefined
    const focusTerminal = vi.fn((_terminalSessionId: string, request?: TerminalFocusRequest) => {
      currentFocusRequest = request
      return connected
    })
    const detach = vi.fn(() => {
      connected = false
    })
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach,
      detach,
      restart: vi.fn(),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      takeover: vi.fn(),
      focusTerminal,
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }
    const navigationGeneration = beginAppNavigation()
    const focusLease = claimTerminalAutoFocus(navigationGeneration)
    if (!focusLease) throw new Error('expected terminal automatic-focus lease')
    focusLease.commit('term-222222222222222222222', focusTerminal)
    expect(focusTerminal).toHaveBeenCalledOnce()
    expect(currentFocusRequest?.isCurrent()).toBe(false)

    const { unmount } = renderInJsdom(
      <StrictMode>
        <TerminalSessionContext value={context}>
          <TerminalSessionReadContext value={readContext}>
            <TerminalSessionView
              repoRoot="/repo"
              workspaceRuntimeId={'repo-runtime-test'}
              branch="feature"
              worktreePath="/worktree"
              selectedTerminalSessionId="term-222222222222222222222"
            />
          </TerminalSessionReadContext>
        </TerminalSessionContext>
      </StrictMode>,
    )

    try {
      await vi.waitFor(() => expect(focusTerminal).toHaveBeenCalledTimes(2))
      expect(attach).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalSessionId: 'term-222222222222222222222',
          index: 2,
          ...terminalDescriptorTargetForTest(),
        }),
        expect.any(HTMLDivElement),
      )
      expect(attach).not.toHaveBeenCalledWith(
        expect.objectContaining({ terminalSessionId: 'term-111111111111111111111' }),
        expect.any(HTMLDivElement),
      )
      expect(focusTerminal).toHaveBeenCalledTimes(2)
      expect(focusTerminal).toHaveBeenLastCalledWith(
        'term-222222222222222222222',
        expect.objectContaining({ isCurrent: expect.any(Function), onSettled: expect.any(Function) }),
      )
      expect(currentFocusRequest?.isCurrent()).toBe(true)
    } finally {
      currentFocusRequest?.onSettled?.()
      unmount()
      resetTerminalAutoFocusForTest()
    }
  })

  test('keeps the active terminal attached when selected descriptor metadata changes', async () => {
    const descriptor = {
      terminalSessionId: 'term-111111111111111111111',
      terminalFilesystemTargetKey: '/repo\0/worktree',
      index: 1,
      ...terminalDescriptorTargetForTest(),
    }
    let terminalFilesystemTargetSnapshot = completeFilesystemTargetSnapshot({
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
        },
      ],
      count: 1,
      createPending: false,
    })
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
      },
    }
    const attach = vi.fn()
    const detach = vi.fn()
    const filesystemTargetListeners = new Set<() => void>()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach,
      detach,
      restart: vi.fn(),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      takeover: vi.fn(),
      focusTerminal: vi.fn(),
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
      subscribeTerminalFilesystemTarget: (_terminalFilesystemTargetKey, listener) => {
        filesystemTargetListeners.add(listener)
        return () => filesystemTargetListeners.delete(listener)
      },
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => snapshot,
      subscribeSnapshot: () => () => {},
    }

    const { unmount } = renderInJsdom(
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
      expect(attach).toHaveBeenCalledTimes(1)

      terminalFilesystemTargetSnapshot = completeFilesystemTargetSnapshot({
        terminalFilesystemTargetKey: '/repo\0/worktree',
        selectedDescriptor: { ...descriptor, index: 2 },
        sessions: [
          {
            terminalSessionId: 'term-111111111111111111111',
            terminalFilesystemTargetKey: '/repo\0/worktree',
            index: 2,
            title: 'zsh',
            phase: 'open' as const,
            selected: true,
            hasBell: false,
          },
        ],
        count: 1,
        createPending: false,
      })
      await act(async () => {
        for (const listener of filesystemTargetListeners) listener()
      })

      expect(attach).toHaveBeenCalledTimes(1)
      expect(detach).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  test('renders mirror attach banner and triggers takeover', async () => {
    const takeover = vi.fn().mockResolvedValue(true)
    const summaries = [
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
    ]
    const descriptor = {
      terminalSessionId: 'term-111111111111111111111',
      terminalFilesystemTargetKey: '/repo\0/worktree',
      index: 1,
      ...terminalDescriptorTargetForTest(),
    }
    const terminalFilesystemTargetSnapshot = {
      terminalFilesystemTargetKey: '/repo\0/worktree',
      selectedDescriptor: descriptor,
      sessions: summaries,
      count: 1,
      createPending: false,
    }
    const snapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'viewer' as const,
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
      takeover,
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
      expect(container.textContent).toContain('terminal.mirror-controlled')
      const host = container.querySelector('.goblin-terminal-session__host')
      expect(host?.getAttribute('aria-readonly')).toBe('true')
      expect(container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeTruthy()
      const button = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.takeover',
      )
      expect(button).toBeDefined()

      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(takeover).toHaveBeenCalledWith('term-111111111111111111111')
    } finally {
      unmount()
    }
  })

  test('does not automatically create a default terminal from render lifecycle', async () => {
    const emptyFilesystemTargetSnapshot = {
      terminalFilesystemTargetKey: '/repo\0/worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      createPending: false,
    }
    const emptySnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
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
      takeover: vi.fn(),
      focusTerminal: vi.fn(),
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(emptyFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => emptySnapshot,
      subscribeSnapshot: () => () => {},
    }

    const tree = (
      <TerminalSessionContext value={context}>
        <TerminalSessionReadContext value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>
    )

    const { container, rerender, unmount } = renderInJsdom(tree)

    try {
      expect(container.querySelector('.goblin-terminal-session__empty')).toBeNull()
      rerender(tree)
    } finally {
      unmount()
    }
  })

  test('hides the xterm host while an existing session is still attaching locally', async () => {
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
    const snapshot = { phase: 'opening' as const, message: null, processName: 'zsh' }
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
      const host = container.querySelector('.goblin-terminal-session__host')
      expect(host?.classList.contains('goblin-terminal-session__host--hidden')).toBe(true)
      expect(host?.getAttribute('aria-readonly')).toBe('true')
      expect(container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeNull()
      expect(container.textContent).toContain('terminal.opening')
    } finally {
      unmount()
    }
  })

  test('shows terminal projection failure reason while opening without sessions', () => {
    const terminalFilesystemTargetSnapshot = {
      terminalFilesystemTargetKey: '/repo\0/worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      createPending: false,
    }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: vi.fn(),
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
      takeover: vi.fn(),
      focusTerminal: vi.fn(),
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
      subscribeSnapshot: () => () => {},
    }

    const { container, unmount } = renderInJsdom(
      <TerminalSessionContext value={context}>
        <TerminalSessionReadContext value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId="repo-runtime-test"
            branch="feature"
            worktreePath="/worktree"
            projectionPhase="failed"
            projectionErrorMessage="error.workspace-runtime-stale"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    try {
      expect(container.textContent).toContain('terminal.load-failed')
      expect(container.textContent).toContain('error.workspace-runtime-stale')
    } finally {
      unmount()
    }
  })

  test('focuses the controller terminal after search closes if ready happened while search was open', async () => {
    const user = userEvent.setup()
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
    const openingSnapshot = { phase: 'opening' as const, message: null, processName: 'zsh' }
    const openSnapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      attachment: {
        role: 'controller' as const,
      },
    }
    const focusTerminal = vi.fn()
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
      takeover: vi.fn(),
      focusTerminal,
    })
    let activeSnapshot: TerminalSnapshot = openingSnapshot
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => activeSnapshot,
      subscribeSnapshot: () => () => {},
    }
    const tree = () => (
      <TerminalSessionContext value={context}>
        <TerminalSessionReadContext value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>
    )

    const { container, rerender, unmount } = renderInJsdom(tree())

    try {
      const root = container.querySelector<HTMLElement>('.goblin-terminal-session')!
      root.focus()
      await user.keyboard('{Meta>}f{/Meta}')
      // Isolate the readiness transition from the initial user focus needed
      // to deliver a real keyboard sequence to the terminal root.
      focusTerminal.mockClear()

      activeSnapshot = openSnapshot
      rerender(tree())

      expect(container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(focusTerminal).not.toHaveBeenCalled()

      await user.keyboard('{Escape}')

      expect(container.querySelector('.goblin-terminal-session__search')).toBeNull()
      expect(focusTerminal).toHaveBeenCalledTimes(1)
      expect(focusTerminal).toHaveBeenCalledWith('term-111111111111111111111')
    } finally {
      unmount()
    }
  })

  test('empty filesystem target shows a New terminal CTA that calls the supplied create operation', async () => {
    // Regression for the "blank screen on first click" symptom: when
    // a filesystem target has no sessions yet, the session renders a CTA so the
    // user doesn't see a featureless black box and can discover the
    // affordance without reaching for the per-target "+" tab.
    const createTerminal = vi.fn(async () => 'raw-session')
    const createTerminalForSlot = vi.fn(async () => 'term-111111111111111111111')
    const emptyFilesystemTargetSnapshot = {
      terminalFilesystemTargetKey: '/repo\0/worktree',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      createPending: false,
    }
    const emptySnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal,
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
      takeover: vi.fn(),
      focusTerminal: vi.fn(),
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(emptyFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => emptySnapshot,
      subscribeSnapshot: () => () => {},
    }

    const { container, unmount } = renderInJsdom(
      <TerminalSessionContext value={context}>
        <TerminalSessionReadContext value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
            createTerminalForSlot={createTerminalForSlot}
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    try {
      // The empty-state CTA is present, with the i18n key as its
      // accessible label and the create button visible.
      const cta = container.querySelector('.goblin-terminal-session__empty-cta')
      expect(cta).toBeTruthy()
      expect(cta?.getAttribute('aria-label')).toBe('terminal.empty')
      const title = container.querySelector('.goblin-terminal-session__empty-title')
      expect(title?.textContent).toBe('terminal.empty')
      const button = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.new',
      )
      expect(button).toBeDefined()

      await act(async () => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(createTerminal).not.toHaveBeenCalled()
      expect(createTerminalForSlot).toHaveBeenCalledTimes(1)
      expect(createTerminalForSlot).toHaveBeenCalledWith({
        ...terminalDescriptorTargetForTest(),
      })
    } finally {
      unmount()
    }
  })

  // ---------------------------------------------------------------------
  // Text-aware paste routing — the fix for the "Excel double-output" bug
  // and the path-aware decision matrix in src/web/clipboard/process.ts.
  // ---------------------------------------------------------------------
})
