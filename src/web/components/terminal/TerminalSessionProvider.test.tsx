// @vitest-environment jsdom

import { seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import {
  bellHandler,
  identityHandler,
  lifecycleHandler,
  outputHandler,
  renderProviderWithHost,
  renderProviderWithProbe,
  renderTerminalProvider,
  REPO_ID,
  repoTerminalBase,
  resetTerminalSessionProviderHarness,
  sessionClosedHandler,
  terminalExitEvent,
  terminalGeometryMocks,
  terminalSessionMocks,
  titleHandler,
  WORKTREE_PATH,
  exitHandler,
} from '#/web/test-utils/terminal-session-provider.tsx'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { setTerminalSessionProjectionForTests } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { createRepoBranch } from '#/web/test-utils/repo-store.ts'

beforeEach(resetTerminalSessionProviderHarness)

describe('TerminalSessionProvider', () => {
  // The Provider reaches the registry via the client-level singleton.
  // Each test must clear the slot so a previous test's bridge wiring
  // doesn't leak into the next one. Mirrors
  // `setTerminalSessionProjectionForTests(null)` in the registry tests.
  afterEach(() => {
    setTerminalSessionProjectionForTests(null)
  })
  describe('realtime projection', () => {
    test('forwards realtime session events to the terminal projection', async () => {
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        currentBranchName: 'feature/worktree',
        preferredWorkspacePaneTab: 'terminal',
      })
      const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
      const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalFilesystemTargetKey)

      try {
        const base = repoTerminalBase()
        await act(async () => {
          await getContext().createTerminal(base)
          await getContext().createTerminal(base)
        })

        const session = terminalSessionMocks()[0]
        if (!session) throw new Error('missing terminal mock session')
        const outputEvent = {
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          data: 'hello',
          seq: 1,
          processName: 'zsh',
        }
        const identityEvent = {
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          identityRevision: 1,
          terminalSessionId: 'term-111111111111111111111',
          role: 'controller' as const,
          controllerStatus: 'connected' as const,
          canonicalSize: { cols: 100, rows: 30 },
        }
        const lifecycleEvent = {
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          phase: 'open' as const,
          message: null,
        }

        await act(async () => {
          outputHandler?.(outputEvent)
          bellHandler?.({
            terminalRuntimeSessionId: 'term-111111111111111111111',
            terminalRuntimeGeneration: 1,
            terminalSessionId: 'term-111111111111111111111',
            workspaceId: REPO_ID,
            processName: 'zsh',
            canonicalTitle: null,
          })
          titleHandler?.({
            terminalRuntimeSessionId: 'term-111111111111111111111',
            terminalRuntimeGeneration: 1,
            terminalSessionId: 'term-111111111111111111111',
            workspaceId: REPO_ID,
            canonicalTitle: '~/Developer/goblin — npm run dev',
          })
          identityHandler?.(identityEvent)
          lifecycleHandler?.(lifecycleEvent)
        })

        expect(session.handleOutput).toHaveBeenCalledWith(outputEvent)
        expect(session.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
        expect(session.handleIdentity).toHaveBeenCalledWith(identityEvent)
        expect(session.handleLifecycle).toHaveBeenCalledWith(lifecycleEvent)
        expect(getProbe().summaries[0]?.hasBell).toBe(true)

        await act(async () => {
          exitHandler?.(terminalExitEvent('term-222222222222222222222'))
        })
        expect(getProbe().terminalIds).toEqual(['term-111111111111111111111'])

        await act(async () => {
          sessionClosedHandler?.({
            terminalRuntimeSessionId: 'term-111111111111111111111',
            terminalRuntimeGeneration: 1,
            terminalSessionId: 'term-111111111111111111111',
            workspaceId: REPO_ID,
            workspaceRuntimeId: 'repo-runtime-test',
            tabsBeforeRetirement: null,
          })
        })
        expect(getProbe().summaries).toEqual([])
      } finally {
        await unmount()
      }
    })
  })

  describe('persisted selection', () => {
    test('applies persisted terminal selection from the workspace store', async () => {
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        currentBranchName: 'feature/worktree',
        preferredWorkspacePaneTab: 'terminal',
      })
      const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
      const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalFilesystemTargetKey)

      try {
        await act(async () => {
          await getContext().createTerminal(repoTerminalBase())
          await getContext().createTerminal(repoTerminalBase())
        })
        await act(async () => {
          useWorkspacesStore.setState({
            selectedTerminalSessionIdByTerminalFilesystemTarget: {
              [terminalFilesystemTargetKey]: 'term-111111111111111111111',
            },
          })
        })

        expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
          ['term-111111111111111111111', true],
          ['term-222222222222222222222', false],
        ])
      } finally {
        await unmount()
      }
    })
  })

  describe('provider lifecycle', () => {
    test('prewarms the terminal font on provider mount', async () => {
      terminalGeometryMocks().preloadTerminalFont.mockClear()
      const result = renderTerminalProvider(<span>probe</span>, { currentWorkspaceId: null })
      try {
        expect(terminalGeometryMocks().preloadTerminalFont).toHaveBeenCalledTimes(1)
      } finally {
        await act(async () => {
          result.unmount()
        })
      }
    })

    test('registers the command bridge and clears it on provider unmount', async () => {
      const { getContext, unmount } = await renderProviderWithHost()

      try {
        expect(readTerminalSessionCommandBridge()?.createTerminal).toBe(getContext().createTerminal)
      } finally {
        await unmount()
      }
      expect(readTerminalSessionCommandBridge()).toBeNull()
    })

    test('preserves singleton projection state across provider remounts', async () => {
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        currentBranchName: 'feature/worktree',
        preferredWorkspacePaneTab: 'terminal',
      })
      const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)

      const first = await renderProviderWithProbe(terminalFilesystemTargetKey)
      try {
        await act(async () => {
          await first.getContext().createTerminal(repoTerminalBase())
        })
        expect(first.getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
      } finally {
        await first.unmount()
      }

      const second = await renderProviderWithProbe(terminalFilesystemTargetKey)
      try {
        expect(second.getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
      } finally {
        await second.unmount()
      }
    })
  })
})
