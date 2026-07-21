// @vitest-environment jsdom

import { act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { TerminalSessionView as TerminalSessionViewComponent } from '#/web/components/terminal/TerminalSessionView.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSessionSummary,
  TerminalSnapshot,
  TerminalFilesystemTargetSnapshot,
} from '#/web/components/terminal/types.ts'
import { canonicalWorkspaceLocator, formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { terminalDescriptorForTest } from '#/web/test-utils/terminal-model.ts'

// Side-effect import: registers a partial mock of `#/web/stores/i18n.ts`
// that delegates to the real module so `i18next.use(initReactI18next).
// init({…})` still runs (which is what wires the i18next singleton into
// `react-i18next`'s module-scoped closure, the one `<Trans>` reads
// from), and only overrides `useT` to return raw keys. See
// `src/test-utils/i18n-mock.ts` for the rationale and the importOriginal
// pattern that backs this side effect.
import { stubI18n } from '#/test-utils/i18n-mock.ts'
stubI18n()

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

// `renderInJsdom` registers `cleanup` via `afterEach`, which
// unmounts all rendered components and removes their containers.

type TestTerminalSessionViewProps = Omit<
  ComponentProps<typeof TerminalSessionViewComponent>,
  'createTerminalForSlot' | 'base'
> & {
  createTerminalForSlot?: ComponentProps<typeof TerminalSessionViewComponent>['createTerminalForSlot']
  repoRoot?: string
  workspaceRuntimeId?: string
  branch?: string | null
  worktreePath?: string
}

const defaultCreateTerminalForSlot = vi.fn(async () => {})

function TerminalSessionView({
  createTerminalForSlot = defaultCreateTerminalForSlot,
  repoRoot = '/repo',
  workspaceRuntimeId = 'repo-runtime-test',
  branch = 'feature',
  worktreePath = '/worktree',
  ...props
}: TestTerminalSessionViewProps) {
  return (
    <TerminalSessionViewComponent
      {...props}
      base={terminalBaseForTest(repoRoot, workspaceRuntimeId, branch, worktreePath)}
      createTerminalForSlot={createTerminalForSlot}
    />
  )
}

function terminalBaseForTest(
  repoRoot: string,
  workspaceRuntimeId: string,
  branch: string | null,
  worktreePath: string,
): TerminalSessionBase {
  const workspaceId = requiredWorkspaceLocator(repoRoot)
  if (branch === null) {
    return {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: workspaceRuntimeId },
      presentation: { kind: 'workspace-root' },
    }
  }
  return {
    target: {
      kind: 'git-worktree' as const,
      workspaceId,
      workspaceRuntimeId: workspaceRuntimeId,
      root: requiredWorkspaceLocator(worktreePath),
    },
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: branch } },
  }
}

function requiredWorkspaceLocator(input: string) {
  const locator =
    canonicalWorkspaceLocator(input) ??
    formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: input }, 'posix')
  if (!locator) throw new Error('invalid workspace locator fixture')
  return locator
}

function terminalDescriptorTargetForTest() {
  return {
    target: {
      kind: 'git-worktree' as const,
      workspaceId: requiredWorkspaceLocator('/repo'),
      workspaceRuntimeId: 'repo-runtime-test',
      root: requiredWorkspaceLocator('/worktree'),
    },
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature' } },
  }
}

type TestTerminalSummary = Omit<TerminalSessionSummary, 'type' | 'hasRecentOutput'> &
  Partial<Pick<TerminalSessionSummary, 'type' | 'hasRecentOutput'>>

type TestFilesystemTargetSnapshot = Omit<
  TerminalFilesystemTargetSnapshot,
  'sessions' | 'bellCount' | 'outputActiveCount'
> & {
  sessions: TestTerminalSummary[]
  bellCount?: number
  outputActiveCount?: number
}

function completeFilesystemTargetSnapshot(snapshot: TestFilesystemTargetSnapshot): TerminalFilesystemTargetSnapshot {
  const sessions = snapshot.sessions.map((session) => ({
    ...session,
    type: 'terminal' as const,
    hasRecentOutput: session.hasRecentOutput ?? false,
  }))
  return {
    ...snapshot,
    sessions,
    bellCount: snapshot.bellCount ?? sessions.filter((session) => session.hasBell).length,
    outputActiveCount: snapshot.outputActiveCount ?? sessions.filter((session) => session.hasRecentOutput).length,
  }
}

async function renderTerminalSession() {
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
  const context: TerminalSessionContextValue = terminalSessionContextForTest({
    createTerminal: async () => 'term-111111111111111111111',
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => true),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    writeInput,
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

  return {
    sessionRoot: container.querySelector('.goblin-terminal-session') as HTMLElement,
    writeInput,
    async cleanup() {
      unmount()
    },
  }
}

function clipboardDataWithFiles(files: File[]): DataTransfer {
  // jsdom's `DataTransfer` is a partial stub; we add `getData` so
  // the session's capture-phase handler can read `text/plain` and treat
  // the absence of text as empty string (matching the real browser
  // behaviour for a file-only clipboard).
  return {
    files: fileListFixture(files),
    items: [],
    getData: (_format: string) => '',
  } as unknown as DataTransfer
}

function fileListFixture(files: File[]): FileList {
  return Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList
}

function dropDataWithFiles(files: File[]): DataTransfer {
  return {
    types: ['Files'],
    files: fileListFixture(files),
    dropEffect: '',
  } as unknown as DataTransfer
}

/**
 * Build a `DataTransfer`-shaped object with both a `files` collection
 * and `getData('text/plain')`. The session's capture-phase paste handler
 * reads both channels synchronously, so we need to fake both.
 */
function clipboardDataWithTextAndFiles(text: string, files: File[]): DataTransfer {
  const base = clipboardDataWithFiles(files) as DataTransfer & {
    getData: (format: string) => string
  }
  base.getData = (format: string) => (format === 'text/plain' ? text : '')
  return base
}

async function dispatchPaste(sessionRoot: HTMLElement, files: File[]): Promise<void> {
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardDataWithFiles(files) })
  await act(async () => {
    sessionRoot.dispatchEvent(pasteEvent)
    await new Promise((r) => setTimeout(r, 0))
  })
}

/**
 * Variant of `dispatchPaste` that also fakes `clipboardData.getData('text/plain')`
 * and returns the event so tests can assert on `defaultPrevented`.
 */
async function dispatchPasteWithText(sessionRoot: HTMLElement, text: string, files: File[] = []): Promise<Event> {
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: clipboardDataWithTextAndFiles(text, files),
  })
  await act(async () => {
    sessionRoot.dispatchEvent(pasteEvent)
    await new Promise((r) => setTimeout(r, 0))
  })
  return pasteEvent
}

describe('TerminalSessionView', () => {
  test('attaches the explicit terminal session before projection selection catches up', async () => {
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
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
      },
    }
    const attach = vi.fn()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach,
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
      takeover: vi.fn(),
      focusTerminal: vi.fn(),
    })
    const readContext: TerminalSessionReadContextValue = {
      terminalFilesystemTargetSnapshot: () => terminalFilesystemTargetSnapshot,
      subscribeTerminalFilesystemTarget: () => () => {},
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
            selectedTerminalSessionId="term-222222222222222222222"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    try {
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
    } finally {
      unmount()
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
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
      },
    }
    const attach = vi.fn()
    const detach = vi.fn()
    const filesystemTargetListeners = new Set<() => void>()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach,
      detach,
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
        controllerStatus: 'connected' as const,
        active: false,
        canTakeover: true,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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

  test('focuses the controller terminal after the ready render shows the host', async () => {
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
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const focusTerminal = vi.fn()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      const host = container.querySelector('.goblin-terminal-session__host')
      expect(host?.classList.contains('goblin-terminal-session__host--hidden')).toBe(true)
      expect(focusTerminal).not.toHaveBeenCalled()

      activeSnapshot = openSnapshot
      rerender(tree())

      const readyHost = container.querySelector('.goblin-terminal-session__host')
      expect(readyHost?.classList.contains('goblin-terminal-session__host--hidden')).toBe(false)
      expect(focusTerminal).toHaveBeenCalledTimes(1)
      expect(focusTerminal).toHaveBeenCalledWith('term-111111111111111111111')

      activeSnapshot = { ...openSnapshot, takeoverPending: true }
      rerender(tree())

      expect(focusTerminal).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })

  test('focuses the controller terminal after search closes if ready happened while search was open', async () => {
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
        controllerStatus: 'connected' as const,
        active: true,
        canTakeover: false,
        canonicalCols: 120,
        canonicalRows: 40,
        phase: 'open' as const,
      },
    }
    const focusTerminal = vi.fn()
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      await act(async () => {
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }))
      })

      activeSnapshot = openSnapshot
      rerender(tree())

      expect(container.querySelector('.goblin-terminal-session__search')).not.toBeNull()
      expect(focusTerminal).not.toHaveBeenCalled()

      await act(async () => {
        root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })

      expect(container.querySelector('.goblin-terminal-session__search')).toBeNull()
      expect(focusTerminal).toHaveBeenCalledTimes(1)
      expect(focusTerminal).toHaveBeenCalledWith('term-111111111111111111111')
    } finally {
      unmount()
    }
  })

  test('error phase as a viewer shows the takeover path, not the restart button', async () => {
    // Regression for the previous two-flag gating where a viewer in
    // error phase would see neither the viewer overlay (open-gated)
    // nor the correctly-gated error chip, leaving the dead restart
    // button visible.
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart,
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      // Viewer overlay is the primary affordance, with a takeover
      // button that the user must click before they can restart.
      expect(container.querySelector('.goblin-terminal-session__viewer-overlay')).toBeTruthy()
      const takeoverButton = Array.from(container.querySelectorAll('button')).find(
        (node) => node.textContent === 'terminal.takeover',
      )
      expect(takeoverButton).toBeDefined()

      // The error chip with its restart button must NOT render for
      // a viewer — that button would silently no-op on the server.
      const errorChips = container.querySelectorAll('.goblin-terminal-session__status-overlay--error')
      expect(errorChips).toHaveLength(0)
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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
      const sessionRoot = container.querySelector('.goblin-terminal-session') as HTMLElement
      expect(sessionRoot).toBeTruthy()
      // Synthesize a Drop event with one file. jsdom's DataTransfer
      // doesn't accept programmatic `files` assignment cleanly, so we
      // build a minimal proxy that satisfies the handler.
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png')
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await act(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        // give the resolver microtask chain a tick — even though we
        // expect it never to run.
        await Promise.resolve()
      })
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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

    // Stub the bridge surface for this test only. The default mock
    // returns '' / [], which would route every file through the
    // blob-save backend and ultimately write nothing. We override
    // to drive the path-attempt tier and assert the resulting
    // shell-escaped writeInput call.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `/resolved/${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

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
      expect(sessionRoot).toBeTruthy()
      const file = new File([new Uint8Array([1, 2, 3])], 'shot with space.png', { type: 'image/png' })
      const dataTransfer = dropDataWithFiles([file])
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })

      await act(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        // processDrop -> resolvePastedFiles -> setTimeout-free, but
        // the handler awaits a Promise chain. Let it drain.
        await new Promise((r) => setTimeout(r, 0))
      })

      // One writeInput call with a shell-escaped path. The path
      // contains a space, so shellEscapePath wraps it in single
      // quotes — if the escape regresses to plain concat this
      // assertion catches it.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/resolved/shot with space.png'", 'drop')
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
    // bubbling so it reaches the session's React listener. We only need
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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
      const sessionRoot = container.querySelector('.goblin-terminal-session') as HTMLElement
      const file = new File([new Uint8Array([1, 2, 3])], 'shot.png')
      const clipboardData = clipboardDataWithFiles([file])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
      await act(async () => {
        sessionRoot.dispatchEvent(pasteEvent)
        await new Promise((r) => setTimeout(r, 0))
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `/resolved/${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

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
      const file = new File([new Uint8Array([1, 2, 3])], 'weird name & space.png')
      const clipboardData = clipboardDataWithFiles([file])
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })

      await act(async () => {
        sessionRoot.dispatchEvent(pasteEvent)
        await new Promise((r) => setTimeout(r, 0))
      })

      // One writeInput call. The path contains a space and an `&`,
      // both of which `shellEscapePath` wraps in single quotes — if
      // the escape regresses to plain concat this catches it.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith(
        'term-111111111111111111111',
        "'/resolved/weird name & space.png'",
        'paste',
      )
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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
        await new Promise((r) => setTimeout(r, 0))
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

  test('paste with an unsafe resolved path falls back to blob-save and writes the temp path', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('/abs/bad\nname.png')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue(['/tmp/safe-name.png'])
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [new File([new Uint8Array([1])], 'bad.png')])

      expect(rendered.writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/tmp/safe-name.png'", 'paste')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-unsafe')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste with an unsafe resolved path surfaces paste-file-failed when blob-save fallback also fails', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('/abs/bad\nname.png')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])
    const { toast } = await import('sonner')
    vi.mocked(toast.error).mockClear()
    const rendered = await renderTerminalSession()

    try {
      await dispatchPaste(rendered.sessionRoot, [new File([new Uint8Array([1])], 'bad.png')])

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
        await new Promise((r) => setTimeout(r, 0))
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

      expect(rendered.writeInput).toHaveBeenCalledWith(
        'term-111111111111111111111',
        "'/abs/a.png' '/tmp/b.png'",
        'paste',
      )
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-partial')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      await rendered.cleanup()
    }
  })

  test('controller drop with partial backend failure writes the resolved paths AND surfaces paste-file-partial', async () => {
    // Locks the toast-mapping contract from §9 of the design doc:
    // a multi-file paste where path-attempt succeeded for some and
    // blob-save succeeded for fewer than the remaining inputs must
    // (a) write the resolved paths to the PTY and (b) toast a
    // paste-file-partial so the user notices the silent loss. The
    // resolver counts failed correctly (resolver.test.ts), but
    // without this integration test nothing pinned the session's
    // writeResolutionToPty wiring.
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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

    // 3 files: a has a path (path-attempt tier), b/c have no path
    // and go to the blob-save tier. Backend returns 1 path (only b
    // made it) so 1 file is "failed".
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) =>
      file.name === 'a.png' ? '/abs/a.png' : '',
    )
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue(['/tmp/b.png'])
    const { toast } = await import('sonner')

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
      vi.mocked(toast.error).mockClear()

      const sessionRoot = container.querySelector('.goblin-terminal-session') as HTMLElement
      const files = [
        new File([new Uint8Array([1])], 'a.png'),
        new File([new Uint8Array([1])], 'b.png'),
        new File([new Uint8Array([1])], 'c.png'),
      ]
      const dataTransfer = dropDataWithFiles(files)
      const dropEvent = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer })
      await act(async () => {
        sessionRoot.dispatchEvent(dropEvent)
        await new Promise((r) => setTimeout(r, 0))
      })

      // writeInput must receive the joined, shell-escaped paths in
      // the order the resolver returns them (path-attempt tier first,
      // then blob-save). paste-file-partial toasts once.
      expect(writeInput).toHaveBeenCalledTimes(1)
      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/abs/a.png' '/tmp/b.png'", 'drop')
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('terminal.paste-file-partial')
      expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith('terminal.paste-file-failed')
    } finally {
      unmount()
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
    const context: TerminalSessionContextValue = terminalSessionContextForTest({
      createTerminal: async () => 'term-111111111111111111111',
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput,
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
      // setTimeout(0) is the established pattern in the other integration
      // tests for draining them all in one act.
      await act(async () => {
        resolveSave(['/tmp/a.png'])
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/tmp/a.png'", 'drop')
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
      registerHost: vi.fn(),
      unregisterHost: vi.fn(),
      selectTerminal: vi.fn(),
      scrollToBottom: vi.fn(),
      scrollLines: vi.fn(),
      clearBell: vi.fn(() => false),
      closeTerminalByDescriptor: vi.fn(async () => true),
      attach: vi.fn(),
      detach: vi.fn(),
      restart: vi.fn(),
      isTerminalFocusTarget: vi.fn(() => false),
      findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
      clearSearch: vi.fn(),
      writeInput: vi.fn(),
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
      expect(rendered.writeInput).toHaveBeenCalledWith('term-111111111111111111111', "'/home/user/foo.png'", 'paste')
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('Windows file copy (single-line path text + real file) prefers files', async () => {
    // Windows Explorer typically renders just the path as `text/plain`
    // with no URI list. The path-attempt tier resolves the real path
    // and shell-quotes it. We preserve this behaviour.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockImplementation((file: File) => `C:\\Users\\me\\${file.name}`)
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()
    const file = new File([new Uint8Array([1])], 'bar.png')

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, 'C:\\Users\\me\\bar.png', [file])

      expect(event.defaultPrevented).toBe(true)
      expect(rendered.writeInput).toHaveBeenCalledWith(
        'term-111111111111111111111',
        "'C:\\Users\\me\\bar.png'",
        'paste',
      )
    } finally {
      await rendered.cleanup()
    }
  })

  test('single-cell Excel paste (plain value + thumbnail blob) defers to xterm.js', async () => {
    // Regression for Issue 1 (terminal pass): a single-cell Excel
    // value (formatted cell with currency / date / borders) attaches
    // a thumbnail blob. The text/plain is the value (no tab, no
    // newline). Old code routed this to files and wrote the
    // thumbnail's path; new code routes to text because the value
    // doesn't look like a path.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()
    const thumbnail = new File([new Uint8Array([1, 2, 3])], 'thumbnail.png', { type: 'image/png' })

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, '42', [thumbnail])
      expect(event.defaultPrevented).toBe(false)
      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('paste a URL alongside an image blob — URL reaches xterm, image is dropped', async () => {
    // Regression for Issue 2 (terminal pass): a URL copied from a
    // browser alongside an image blob. The URL is real text the user
    // wants, not a filesystem path.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()
    const image = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, 'https://example.com/foo', [image])
      expect(event.defaultPrevented).toBe(false)
      expect(rendered.writeInput).not.toHaveBeenCalled()
      expect(shellClient.saveClipboardFiles).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })

  test('single-row Excel paste (single-line TSV + thumbnail blob) defers to xterm.js', async () => {
    // Regression for Issue 1: a single-row Excel copy used to be
    // misclassified as "single-line non-URI → files" and the
    // thumbnail got blob-saved. Tab is the load-bearing signal —
    // single-row TSV has tabs without newlines.
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()
    const thumbnail = new File([new Uint8Array([1, 2, 3])], 'thumbnail.png', { type: 'image/png' })
    const tsv = 'Alice\t30\tNYC'

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, tsv, [thumbnail])
      expect(event.defaultPrevented).toBe(false)
      expect(rendered.writeInput).not.toHaveBeenCalled()
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

  test('empty clipboard (no text, no files) is a no-op', async () => {
    const shellClient = await import('#/web/app-shell-client.ts')
    vi.mocked(shellClient.pathForDroppedFile).mockReturnValue('')
    vi.mocked(shellClient.saveClipboardFiles).mockResolvedValue([])

    const rendered = await renderTerminalSession()

    try {
      const event = await dispatchPasteWithText(rendered.sessionRoot, '', [])
      expect(event.defaultPrevented).toBe(false)
      expect(rendered.writeInput).not.toHaveBeenCalled()
    } finally {
      await rendered.cleanup()
    }
  })
})
