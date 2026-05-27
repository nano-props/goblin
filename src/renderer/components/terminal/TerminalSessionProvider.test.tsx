// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalSessionProvider } from '#/renderer/components/terminal/TerminalSessionProvider.tsx'
import { useTerminalSessionContext } from '#/renderer/components/terminal/terminal-session-context.ts'
import { terminalSessionGroupKey } from '#/renderer/components/terminal/terminal-session-utils.ts'
import { createBranch, resetReposStore, seedRepoState } from '#/renderer/stores/repos/test-utils.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type {
  TerminalDescriptor,
  TerminalSearchResult,
  TerminalSessionContextValue,
  TerminalSnapshot,
} from '#/renderer/components/terminal/types.ts'
import type { TerminalExitEvent, TerminalOutputEvent } from '#/shared/terminal.ts'

vi.mock('#/renderer/components/terminal/ManagedTerminalSession.ts', () => {
  class ManagedTerminalSession {
    descriptor: TerminalDescriptor

    constructor(descriptor: TerminalDescriptor) {
      this.descriptor = descriptor
    }

    updateDescriptor(descriptor: TerminalDescriptor) {
      this.descriptor = descriptor
    }

    attach() {}

    detach() {}

    restart() {}

    dispose() {}

    snapshot(): TerminalSnapshot {
      return { phase: 'open', message: null, processName: `terminal ${this.descriptor.index}` }
    }

    isTerminalFocusTarget(): boolean {
      return false
    }

    findNext(): TerminalSearchResult {
      return { resultIndex: -1, resultCount: 0, found: false }
    }

    findPrevious(): TerminalSearchResult {
      return { resultIndex: -1, resultCount: 0, found: false }
    }

    clearSearch() {}

    writeInput() {}

    serialize(): string {
      return ''
    }

    handleOutput(_event: TerminalOutputEvent) {}

    handleExit(event: TerminalExitEvent): boolean {
      return event.sessionId === this.descriptor.terminalId
    }
  }

  return { ManagedTerminalSession }
})

const REPO_ID = '/tmp/gbl-terminal-provider-repo'
const WORKTREE_PATH = '/tmp/gbl-terminal-provider-worktree'

let exitHandler: ((event: TerminalExitEvent) => void) | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  exitHandler = null
  resetReposStore()
  document.body.innerHTML = ''
  Object.defineProperty(window, 'goblin', {
    configurable: true,
    value: {
      homeDir: '/Users/test',
      invokeRpc: vi.fn(async () => []),
      abortRpc: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      terminal: {
        open: vi.fn(async () => ({
          ok: true,
          sessionId: 'unused',
          replay: '',
          replaySeq: 0,
          replayTruncated: false,
          processName: 'zsh',
        })),
        restart: vi.fn(async () => ({
          ok: true,
          sessionId: 'unused',
          replay: '',
          replaySeq: 0,
          replayTruncated: false,
          processName: 'zsh',
        })),
        write: vi.fn(async () => true),
        resize: vi.fn(async () => true),
        close: vi.fn(async () => true),
        pruneRepo: vi.fn(async () => true),
        onOutput: vi.fn(() => () => {}),
        onExit: vi.fn((cb: (event: TerminalExitEvent) => void) => {
          exitHandler = cb
          return () => {}
        }),
      },
    },
  })
})

describe('TerminalSessionProvider', () => {
  test('keeps terminal detail open and switches active session when one of multiple terminals exits', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createBranch('feature/worktree', { worktreePath: WORKTREE_PATH })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    useReposStore.setState({ detailCollapsed: false })
    const { getContext, unmount } = await renderProvider()

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        getContext().ensureDefault(base)
        getContext().createTerminal(base)
      })

      const groupKey = terminalSessionGroupKey(REPO_ID, WORKTREE_PATH)
      expect(
        getContext()
          .sessionSummaries(groupKey)
          .map((session) => [session.terminalId, session.active]),
      ).toEqual([
        ['terminal-1', false],
        ['terminal-2', true],
      ])

      await act(async () => {
        exitHandler?.({ sessionId: 'terminal-2' })
      })

      expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('terminal')
      expect(useReposStore.getState().detailCollapsed).toBe(false)
      expect(
        getContext()
          .sessionSummaries(groupKey)
          .map((session) => [session.terminalId, session.active]),
      ).toEqual([['terminal-1', true]])

      await act(async () => {
        exitHandler?.({ sessionId: 'terminal-1' })
      })

      expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('status')
      expect(useReposStore.getState().detailCollapsed).toBe(true)
    } finally {
      await unmount()
    }
  })
})

function CaptureContext({ onContext }: { onContext: (value: TerminalSessionContextValue) => void }) {
  onContext(useTerminalSessionContext())
  return null
}

async function renderProvider(): Promise<{
  getContext: () => TerminalSessionContextValue
  unmount: () => Promise<void>
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let context: TerminalSessionContextValue | null = null

  await act(async () => {
    root.render(
      <TerminalSessionProvider>
        <CaptureContext onContext={(value) => (context = value)} />
      </TerminalSessionProvider>,
    )
  })

  return {
    getContext: () => {
      if (!context) throw new Error('Terminal session context was not captured')
      return context
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
