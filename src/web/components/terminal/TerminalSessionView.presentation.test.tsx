// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST } from '#/web/test-utils/terminal-snapshot.ts'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalFocusRequest,
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import { claimTerminalAutoFocus, resetTerminalAutoFocusForTest } from '#/web/terminal-focus.ts'
import { beginAppNavigation } from '#/web/app-navigation-lifecycle.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import {
  TerminalSessionView,
  completeFilesystemTargetSnapshot,
  renderTerminalSession,
  terminalDescriptorTargetForTest,
} from '#/web/test-utils/terminal-session-view.tsx'

const EMPTY_OPENING_SNAPSHOT = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
} as const

describe('TerminalSessionView presentation and focus', () => {
  test('retries precommitted focus when the view mounts', async () => {
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
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
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
      <TerminalSessionCommandScope value={context}>
        <TerminalSessionReadScope value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
            selectedTerminalSessionId="term-222222222222222222222"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
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
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
      attachment: {
        role: 'controller' as const,
      },
    }
    const attach = vi.fn()
    const detach = vi.fn()
    const clearSearch = vi.fn()
    const filesystemTargetListeners = new Set<() => void>()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach,
      detach,
      restart: vi.fn(),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch,
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
      await flushTestUpdates(() => {})
      expect(attach).toHaveBeenCalledTimes(1)
      expect(clearSearch).not.toHaveBeenCalled()

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
      await flushTestUpdates(async () => {
        for (const listener of filesystemTargetListeners) listener()
      })

      expect(attach).toHaveBeenCalledTimes(1)
      expect(detach).not.toHaveBeenCalled()
      expect(clearSearch).not.toHaveBeenCalled()
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
      expect(container.textContent).toContain('terminal.mirror-controlled')
      const host = container.querySelector('.goblin-terminal-session__host')
      expect(host?.getAttribute('aria-readonly')).toBe('true')
      expect(container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeTruthy()
      const button = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.takeover',
      )
      expect(button).toBeDefined()

      await flushTestUpdates(async () => {
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
    const emptySnapshot = {
      phase: 'opening' as const,
      message: null,
      processName: 'terminal',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
    }
    const createTerminal = vi.fn(async () => 'term-222222222222222222222')
    const createTerminalForSlot = vi.fn(async () => 'term-333333333333333333333')
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal,
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
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

    const tree = () => (
      <TerminalSessionCommandScope value={context}>
        <TerminalSessionReadScope value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
            createTerminalForSlot={createTerminalForSlot}
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>
    )

    const { container, rerender, unmount } = renderInJsdom(tree())

    try {
      expect(container.querySelector('.goblin-terminal-session__empty')).toBeNull()
      expect(createTerminal).not.toHaveBeenCalled()
      expect(createTerminalForSlot).not.toHaveBeenCalled()
      await rerender(tree())
      expect(createTerminal).not.toHaveBeenCalled()
      expect(createTerminalForSlot).not.toHaveBeenCalled()
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
    const snapshot = {
      phase: 'opening' as const,
      message: null,
      processName: 'zsh',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
    }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
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
      const host = container.querySelector('.goblin-terminal-session__host')
      expect(host?.classList.contains('goblin-terminal-session__host--hidden')).toBe(true)
      expect(host?.getAttribute('aria-readonly')).toBe('true')
      expect(container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeNull()
      expect(container.textContent).toContain('terminal.opening')
    } finally {
      unmount()
    }
  })

  test('shows terminal projection failure reason while opening without sessions', async () => {
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
      snapshot: () => EMPTY_OPENING_SNAPSHOT,
      subscribeSnapshot: () => () => {},
    }

    const { container, unmount } = renderInJsdom(
      <TerminalSessionCommandScope value={context}>
        <TerminalSessionReadScope value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId="repo-runtime-test"
            branch="feature"
            worktreePath="/worktree"
            projectionPhase="failed"
            projectionErrorMessage="error.workspace-runtime-stale"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
    )

    try {
      expect(container.textContent).toContain('terminal.load-failed')
      expect(container.textContent).toContain('error.workspace-runtime-stale')
    } finally {
      unmount()
    }
  })

  test('does not force terminal focus after search closes if ready happened while search was open', async () => {
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
    const openingSnapshot: TerminalSnapshot = {
      phase: 'opening',
      message: null,
      processName: 'zsh',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
    }
    const openSnapshot = {
      phase: 'open' as const,
      message: null,
      processName: 'zsh',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
      attachment: {
        role: 'controller' as const,
      },
    }
    const focusTerminal = vi.fn()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
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
    const snapshotListeners = new Set<() => void>()
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
      subscribeTerminalFilesystemTarget: () => () => {},
      workspaceBellCount: () => 0,
      subscribeWorkspaceBellCount: () => () => {},
      snapshot: () => activeSnapshot,
      subscribeSnapshot: (_terminalSessionId, listener) => {
        snapshotListeners.add(listener)
        return () => snapshotListeners.delete(listener)
      },
    }
    const tree = () => (
      <TerminalSessionCommandScope value={context}>
        <TerminalSessionReadScope value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>
    )

    const { container, unmount } = renderInJsdom(tree())

    try {
      const root = container.querySelector<HTMLElement>('.goblin-terminal-session')!
      root.focus()
      await user.keyboard('{Meta>}f{/Meta}')
      // Isolate the readiness transition from the initial user focus needed
      // to deliver a real keyboard sequence to the terminal root.
      focusTerminal.mockClear()

      activeSnapshot = openSnapshot
      await flushTestUpdates(() => {
        for (const listener of snapshotListeners) listener()
      })

      expect(container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(container.querySelector('.goblin-terminal-session__host--hidden')).toBeNull()
      expect(focusTerminal).not.toHaveBeenCalled()

      await user.keyboard('{Escape}')

      expect(container.querySelector('.goblin-terminal-session__search')).toBeNull()
      expect(focusTerminal).not.toHaveBeenCalled()
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
    const emptySnapshot = {
      phase: 'opening' as const,
      message: null,
      processName: 'terminal',
      composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
    }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal,
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
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
      <TerminalSessionCommandScope value={context}>
        <TerminalSessionReadScope value={readContext}>
          <TerminalSessionView
            repoRoot="/repo"
            workspaceRuntimeId={'repo-runtime-test'}
            branch="feature"
            worktreePath="/worktree"
            createTerminalForSlot={createTerminalForSlot}
          />
        </TerminalSessionReadScope>
      </TerminalSessionCommandScope>,
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

      await flushTestUpdates(async () => {
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

  test('shows passive restoring feedback for an open local presentation rebuild', async () => {
    const view = await renderTerminalSession(
      {},
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
          attachment: { role: 'controller' },
          presentationRecovery: 'pending',
        },
      },
    )

    try {
      const status = view.container.querySelector('[role="status"]')
      expect(status?.textContent).toContain('terminal.restoring')
      expect(status?.getAttribute('aria-busy')).toBe('true')
      expect(view.container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('shows an accessible attach-only retry and replaces it when recovery becomes pending', async () => {
    const retryPresentation = vi.fn(() => true)
    const view = await renderTerminalSession(
      { retryPresentation },
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
          attachment: { role: 'controller' },
          presentationRecovery: 'failed',
        },
      },
    )

    try {
      const alert = view.container.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain('terminal.restore-failed')
      expect(alert?.getAttribute('aria-live')).toBe('polite')
      expect(alert?.getAttribute('aria-atomic')).toBe('true')
      const retry = Array.from(view.container.querySelectorAll('button')).find(
        (button) => button.textContent === 'error.try-again',
      )

      await flushTestUpdates(async () => retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      expect(retryPresentation).toHaveBeenCalledWith('term-111111111111111111111')

      await view.publishSnapshot({
        phase: 'open',
        message: null,
        processName: 'zsh',
        composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
        attachment: { role: 'controller' },
        presentationRecovery: 'pending',
      })
      expect(view.container.querySelector('[role="alert"]')).toBeNull()
      expect(view.container.textContent).toContain('terminal.restoring')
      expect(view.container.textContent).not.toContain('error.try-again')
    } finally {
      await view.cleanup()
    }
  })

  test('renders workspace projection failure as static feedback during presentation recovery', async () => {
    const view = await renderTerminalSession(
      {},
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
          attachment: { role: 'controller' },
          presentationRecovery: 'pending',
        },
        projectionPhase: 'failed',
      },
    )

    try {
      const alert = view.container.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain('terminal.load-failed')
      expect(alert?.hasAttribute('aria-busy')).toBe(false)
      expect(view.container.querySelector('.goblin-terminal-session__status-dot')).toBeNull()
      expect(alert?.querySelector('button')).toBeNull()
    } finally {
      await view.cleanup()
    }
  })

  test('keeps unowned attachment passive and reserves takeover for true viewers', async () => {
    const unowned = await renderTerminalSession(
      {},
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
          attachment: { role: 'unowned' },
        },
      },
    )

    try {
      expect(unowned.container.textContent).toContain('terminal.unowned')
      expect(unowned.container.textContent).not.toContain('terminal.takeover')
      expect(unowned.container.querySelector('button')).toBeNull()
    } finally {
      await unowned.cleanup()
    }

    const viewer = await renderTerminalSession(
      {},
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
          attachment: { role: 'viewer' },
          takeoverPending: true,
        },
      },
    )
    try {
      const button = viewer.container.querySelector('button')
      expect(button?.textContent).toBe('terminal.taking-over')
      expect(button?.getAttribute('aria-busy')).toBe('true')
      expect(button?.hasAttribute('disabled')).toBe(true)
    } finally {
      await viewer.cleanup()
    }
  })

  test.each([
    ['not-sent', 'unavailable', 'not-sent', 'error'],
    ['indeterminate', 'disconnected', 'indeterminate', 'warning'],
    ['app quitting', 'app-quitting', 'indeterminate', 'silent'],
  ] as const)('maps %s takeover transport failure at the feedback boundary', async (_label, kind, delivery, tone) => {
    const { toast } = await import('vue-sonner')
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.warning).mockClear()
    const takeover = vi.fn().mockRejectedValue(
      new ClientRealtimeRequestError('takeover failed', {
        kind,
        delivery,
        outageId: kind === 'app-quitting' ? null : 1,
      }),
    )
    const view = await renderTerminalSession(
      { takeover },
      {
        snapshot: {
          phase: 'open',
          message: null,
          processName: 'zsh',
          composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
          attachment: { role: 'viewer' },
        },
      },
    )

    try {
      const button = view.container.querySelector('button')
      await flushTestUpdates(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

      expect(toast.error).toHaveBeenCalledTimes(tone === 'error' ? 1 : 0)
      expect(toast.warning).toHaveBeenCalledTimes(tone === 'warning' ? 1 : 0)
    } finally {
      await view.cleanup()
    }
  })

  // ---------------------------------------------------------------------
  // Text-aware paste routing — the fix for the "Excel double-output" bug
  // and the path-aware decision matrix in src/web/clipboard/process.ts.
  // ---------------------------------------------------------------------
})
