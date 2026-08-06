import { act } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import { EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST } from '#/web/test-utils/terminal-snapshot.ts'
import { TerminalSessionView as TerminalSessionViewComponent } from '#/web/components/terminal/TerminalSessionView.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalSessionSummary,
  TerminalFilesystemTargetSnapshot,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import { canonicalWorkspaceLocator, formatWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { stubI18n } from '#/test-utils/i18n-mock.ts'

stubI18n()

vi.mock('#/web/app-shell-client.ts', () => ({
  pathForDroppedFile: vi.fn(() => ''),
  saveClipboardFiles: vi.fn(() => Promise.resolve([])),
}))

const terminalSessionViewToast = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  message: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: terminalSessionViewToast }))

export function terminalSessionViewToastForTest() {
  return terminalSessionViewToast
}

// No testing-library fixture models this context/read-model plus clipboard and drop boundary.
// Keep the DOM harness shared while each suite owns one observable TerminalSessionView behavior.
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

export function TerminalSessionView({
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

export function terminalDescriptorTargetForTest() {
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

export type TestFilesystemTargetSnapshot = Omit<
  TerminalFilesystemTargetSnapshot,
  'sessions' | 'bellCount' | 'outputActiveCount'
> & {
  sessions: TestTerminalSummary[]
  bellCount?: number
  outputActiveCount?: number
}

export function completeFilesystemTargetSnapshot(
  snapshot: TestFilesystemTargetSnapshot,
): TerminalFilesystemTargetSnapshot {
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

export async function renderTerminalSession(
  contextOverrides: Partial<TerminalSessionContextValue> = {},
  options: { snapshot?: TerminalSnapshot; projectionPhase?: 'pending' | 'ready' | 'failed' } = {},
) {
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
  let snapshot: TerminalSnapshot = options.snapshot ?? {
    phase: 'open',
    message: null,
    processName: 'zsh',
    composer: EMPTY_TERMINAL_COMPOSER_STATE_FOR_TEST,
    attachment: {
      role: 'controller',
    },
  }
  const snapshotListeners = new Set<() => void>()
  const updateComposer = (composer: TerminalSnapshot['composer']) => {
    snapshot = { ...snapshot, composer }
    for (const listener of snapshotListeners) listener()
  }
  const context: TerminalSessionContextValue = terminalSessionContextForTest({
    createTerminal: async () => 'term-111111111111111111111',
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    readVisibleText: vi.fn(() => null),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(async () => true),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    openComposer: (terminalSessionId) => {
      if (terminalSessionId !== descriptor.terminalSessionId) return false
      updateComposer({ ...snapshot.composer, expanded: true, mode: 'input' })
      return true
    },
    closeComposer: (terminalSessionId) => {
      if (terminalSessionId !== descriptor.terminalSessionId) return false
      if (snapshot.composer.expanded) updateComposer({ ...snapshot.composer, expanded: false })
      return true
    },
    setComposerMode: (terminalSessionId, mode) => {
      if (terminalSessionId !== descriptor.terminalSessionId) return false
      if (snapshot.composer.mode !== mode) updateComposer({ ...snapshot.composer, mode })
      return true
    },
    setComposerDraft: (terminalSessionId, draft) => {
      if (terminalSessionId !== descriptor.terminalSessionId) return false
      if (snapshot.composer.draft !== draft) updateComposer({ ...snapshot.composer, draft })
      return true
    },
    replaceComposerDraft: (terminalSessionId, expectedDraft, draft) => {
      if (terminalSessionId !== descriptor.terminalSessionId) return false
      if (snapshot.composer.draft !== expectedDraft || expectedDraft === draft) return false
      updateComposer({ ...snapshot.composer, draft })
      return true
    },
    captureInputWriter: (terminalSessionId) => (data) => {
      writeInput(terminalSessionId, data)
      return true
    },
    submitText: async (terminalSessionId, text) => {
      writeInput(terminalSessionId, text)
      return true
    },
    takeover: vi.fn(),
    focusTerminal: vi.fn(),
    ...contextOverrides,
  })
  const readContext: TerminalSessionReadContextValue = {
    terminalFilesystemTargetSnapshot: () => completeFilesystemTargetSnapshot(terminalFilesystemTargetSnapshot),
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 0,
    subscribeWorkspaceBellCount: () => () => {},
    snapshot: () => snapshot,
    subscribeSnapshot: (_terminalSessionId, listener) => {
      snapshotListeners.add(listener)
      return () => snapshotListeners.delete(listener)
    },
  }

  const { container, unmount } = renderInJsdom(
    <TerminalSessionContext value={context}>
      <TerminalSessionReadContext value={readContext}>
        <TerminalSessionView
          repoRoot="/repo"
          workspaceRuntimeId={'repo-runtime-test'}
          branch="feature"
          worktreePath="/worktree"
          projectionPhase={options.projectionPhase}
        />
      </TerminalSessionReadContext>
    </TerminalSessionContext>,
  )

  return {
    container,
    sessionRoot: container.querySelector('.goblin-terminal-session') as HTMLElement,
    writeInput,
    async publishSnapshot(next: TerminalSnapshot) {
      snapshot = next
      await act(async () => {
        for (const listener of snapshotListeners) listener()
      })
    },
    async cleanup() {
      unmount()
    },
  }
}

export function clipboardDataWithFiles(files: File[]): DataTransfer {
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

export function dropDataWithFiles(files: File[]): DataTransfer {
  return {
    types: ['Files'],
    files: fileListFixture(files),
    dropEffect: '',
  } as unknown as DataTransfer
}

export function captureInputWriterForTest(writeInput: (terminalSessionId: string, data: string) => void) {
  return (terminalSessionId: string) => (data: string) => {
    writeInput(terminalSessionId, data)
    return true
  }
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

export async function dispatchPaste(sessionRoot: HTMLElement, files: File[]): Promise<void> {
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardDataWithFiles(files) })
  await act(async () => {
    sessionRoot.dispatchEvent(pasteEvent)
    await waitForNextMacrotask()
  })
}

/**
 * Variant of `dispatchPaste` that also fakes `clipboardData.getData('text/plain')`
 * and returns the event so tests can assert on `defaultPrevented`.
 */
export async function dispatchPasteWithText(
  sessionRoot: HTMLElement,
  text: string,
  files: File[] = [],
): Promise<Event> {
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: clipboardDataWithTextAndFiles(text, files),
  })
  await act(async () => {
    sessionRoot.dispatchEvent(pasteEvent)
    await waitForNextMacrotask()
  })
  return pasteEvent
}
