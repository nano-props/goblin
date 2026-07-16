// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { TerminalDescriptor, TerminalRepoIndex } from '#/web/components/terminal/types.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { terminalClient } from '#/web/terminal.ts'
import { resetReposStore } from '#/web/test-utils/bridge.ts'

const workspacePaneRuntimeMocks = vi.hoisted(() => ({
  close: vi.fn(),
  writeSnapshot: vi.fn(),
  refreshTabs: vi.fn(),
}))

vi.mock('#/web/workspace-pane/workspace-pane-runtime-client.ts', () => ({
  workspacePaneRuntimeClient: {
    close: workspacePaneRuntimeMocks.close,
  },
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-commit.ts', () => ({
  writeCanonicalWorkspacePaneTabsSnapshot: workspacePaneRuntimeMocks.writeSnapshot,
}))

vi.mock('#/web/workspace-pane/workspace-pane-tabs-query.ts', () => ({
  refreshWorkspacePaneTabs: workspacePaneRuntimeMocks.refreshTabs,
}))

const REPO_ROOT = '/repo'
const REPO_RUNTIME_ID = 'repo-runtime-test'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = formatTerminalWorktreeKey(REPO_ROOT, WORKTREE_PATH)

function makeDescriptor(terminalSessionId: string, index: number): TerminalDescriptor {
  return {
    terminalSessionId,
    terminalWorktreeKey: WORKTREE_KEY,
    index,
    repoRuntimeId: REPO_RUNTIME_ID,
    repoRoot: REPO_ROOT,
    branch: BRANCH,
    worktreePath: WORKTREE_PATH,
  }
}

function makeRepoIndex(repoRuntimeId = REPO_RUNTIME_ID): TerminalRepoIndex {
  return {
    [REPO_ROOT]: {
      repoRuntimeId,
      branchByWorktreePath: { [WORKTREE_PATH]: BRANCH },
    },
  }
}

function makeServerSession(
  terminalRuntimeSessionId: string,
  terminalSessionId: string,
  overrides: Partial<{
    terminalRuntimeGeneration: number
    controller: { clientId: string; status: 'connected' }
    processName: string
    canonicalTitle: string | null
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    cols: number
    rows: number
    repoRuntimeId: string
  }> = {},
): TerminalSessionSummary {
  return {
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: overrides.terminalRuntimeGeneration ?? 1,
    terminalSessionId,
    repoRuntimeId: overrides.repoRuntimeId ?? REPO_RUNTIME_ID,
    repoRoot: REPO_ROOT,
    branch: BRANCH,
    worktreePath: WORKTREE_PATH,
    cwd: WORKTREE_PATH,
    controller: overrides.controller ?? null,
    processName: overrides.processName ?? 'bash',
    canonicalTitle: overrides.canonicalTitle ?? null,
    phase: overrides.phase ?? 'open',
    message: overrides.message ?? null,
    cols: overrides.cols ?? 80,
    rows: overrides.rows ?? 24,
  }
}

function successfulRuntimeCloseSnapshot(
  terminalSessionId = 'term-111111111111111111111',
  terminalRuntimeSessionId: string | null = 'pty_session_1_aaaaaaaaa',
) {
  return {
    ok: true as const,
    runtimeType: 'terminal' as const,
    runtime: {
      action: terminalRuntimeSessionId === null ? ('already-closed' as const) : ('closed' as const),
      terminalSessionId,
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: terminalRuntimeSessionId === null ? null : 1,
    },
    workspacePaneTabs: { revision: 2, entries: [] },
  }
}

describe('TerminalSessionProjection', () => {
  let projection: TerminalSessionProjection
  let selectedChanges: Array<{ terminalWorktreeKey: string; terminalSessionId: string | null }>

  beforeEach(() => {
    resetReposStore()
    workspacePaneRuntimeMocks.close.mockReset()
    workspacePaneRuntimeMocks.close.mockResolvedValue(successfulRuntimeCloseSnapshot())
    workspacePaneRuntimeMocks.writeSnapshot.mockReset()
    workspacePaneRuntimeMocks.writeSnapshot.mockResolvedValue(true)
    workspacePaneRuntimeMocks.refreshTabs.mockReset()
    selectedChanges = []
    projection = new TerminalSessionProjection((terminalWorktreeKey, terminalSessionId) =>
      selectedChanges.push({ terminalWorktreeKey, terminalSessionId }),
    )
    // Install into the singleton session so any code that reaches the
    // projection via `getTerminalSessionProjection()` (e.g., a Provider
    // mounted inside a sub-component) sees the same instance this
    // test constructed.
    setTerminalSessionProjectionForTests(projection)
  })

  afterEach(() => {
    vi.useRealTimers()
    // Drain pending state and clear listener maps on the per-test
    // instance, then release the singleton session so the next test
    // starts clean. Mirrors the production singleton-vs-test
    // contract documented at `setTerminalSessionProjectionForTests`.
    projection.destroy()
    setTerminalSessionProjectionForTests(null)
    resetReposStore()
  })

  test('rejects reconciliation for a repo runtime outside the current repo index', () => {
    projection.setRepoIndex(makeRepoIndex())

    const reconciled = projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: 'repo-runtime-old' },
      [
        makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111', {
          repoRuntimeId: 'repo-runtime-old',
        }),
      ],
      'client_local',
      new Map(),
    )

    expect(reconciled).toBe(false)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
  })

  describe('versioned terminal session snapshots', () => {
    test('rejects older snapshots without evicting the accepted projection', () => {
      projection.setRepoIndex(makeRepoIndex())
      expect(
        projection.reconcileServerSessionsSnapshot(
          { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
          {
            revision: 2,
            sessions: [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
          },
          'client_local',
        ),
      ).toBe(true)

      expect(
        projection.reconcileServerSessionsSnapshot(
          { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
          { revision: 1, sessions: [] },
          'client_local',
        ),
      ).toBe(false)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    })

    test('accepts equal revisions for metadata refresh and higher revisions for removal', () => {
      projection.setRepoIndex(makeRepoIndex())
      const scope = { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }
      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 2,
          sessions: [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        },
        'client_local',
      )

      expect(
        projection.reconcileServerSessionsSnapshot(
          scope,
          {
            revision: 2,
            sessions: [
              makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111', {
                processName: 'node',
                canonicalTitle: 'build',
              }),
            ],
          },
          'client_local',
        ),
      ).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]).toMatchObject({
        processName: 'node',
        originalTitle: 'build',
      })

      expect(projection.reconcileServerSessionsSnapshot(scope, { revision: 3, sessions: [] }, 'client_local')).toBe(
        true,
      )
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps an active exit terminal across repeated same-revision snapshots until authoritative absence', () => {
      projection.setRepoIndex(makeRepoIndex())
      const scope = { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }
      const terminalSessionId = 'term-111111111111111111111'
      const terminalRuntimeSessionId = 'pty_active_exit_aaaaaaaaa'
      const snapshot = {
        revision: 10,
        sessions: [makeServerSession(terminalRuntimeSessionId, terminalSessionId)],
      }
      projection.reconcileServerSessionsSnapshot(scope, snapshot, 'client_local')

      projection.handleExit({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 1,
        terminalSessionId,
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      })
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)

      expect(projection.reconcileServerSessionsSnapshot(scope, snapshot, 'client_local')).toBe(true)
      expect(projection.reconcileServerSessionsSnapshot(scope, snapshot, 'client_local')).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
      expect((projection as any).futureExitOrphans.size()).toBe(1)

      projection.reconcileServerSessionsSnapshot(scope, { revision: 11, sessions: [] }, 'client_local')
      expect((projection as any).futureExitOrphans.size()).toBe(0)
    })

    test('does not let an older exact exit tombstone block a newer runtime generation', () => {
      projection.setRepoIndex(makeRepoIndex())
      const scope = { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID }
      const terminalSessionId = 'term-111111111111111111111'
      const terminalRuntimeSessionId = 'pty_generation_exit_aaaaaa'
      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 10,
          sessions: [makeServerSession(terminalRuntimeSessionId, terminalSessionId)],
        },
        'client_local',
      )
      projection.handleExit({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 1,
        terminalSessionId,
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      })

      projection.reconcileServerSessionsSnapshot(
        scope,
        {
          revision: 11,
          sessions: [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 2 })],
        },
        'client_local',
      )

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      expect((projection as any).sessions.get(terminalSessionId).currentRuntimeBinding()).toEqual({
        terminalRuntimeSessionId,
        terminalRuntimeGeneration: 2,
      })
    })

    test('uses a fresh revision epoch for a replacement repo runtime and after destroy', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessionsSnapshot(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        { revision: 10, sessions: [] },
        'client_local',
      )
      const replacementRuntimeId = 'repo-runtime-replacement'
      projection.setRepoIndex({
        [REPO_ROOT]: {
          repoRuntimeId: replacementRuntimeId,
          branchByWorktreePath: { [WORKTREE_PATH]: BRANCH },
        },
      })
      expect(
        projection.reconcileServerSessionsSnapshot(
          { repoRoot: REPO_ROOT, repoRuntimeId: replacementRuntimeId },
          {
            revision: 1,
            sessions: [
              makeServerSession('pty_session_b_aaaaaaaaa', 'term-222222222222222222222', {
                repoRuntimeId: replacementRuntimeId,
              }),
            ],
          },
          'client_local',
        ),
      ).toBe(true)

      projection.destroy()
      projection.setRepoIndex(makeRepoIndex())
      expect(
        projection.reconcileServerSessionsSnapshot(
          { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
          { revision: 1, sessions: [] },
          'client_local',
        ),
      ).toBe(true)
    })
  })

  describe('event dispatch', () => {
    test('dispatches output to the correct session by terminalRuntimeSessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalWorktreeSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      const terminalSessionId = terminalWorktreeSnapshot.sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        data: 'hello',
        seq: 1,
        outputEra: 0,
        processName: 'bash',
      })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        data: 'hello',
        seq: 1,
        outputEra: 0,
        processName: 'bash',
      })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)
    })

    test('recovers output that arrived before the pty index through the next server snapshot', () => {
      projection.setRepoIndex(makeRepoIndex())
      const terminalRuntimeSessionId = 'pty_session_late_aaaaaaaaa'
      const hydrateSpy = vi.spyOn(TerminalSession.prototype, 'hydrate')

      try {
        projection.handleOutput({
          terminalRuntimeSessionId,
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          data: 'before-index',
          seq: 1,
          outputEra: 0,
          processName: 'bash',
        })
        expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions).toEqual([])

        projection.reconcileServerSessions(
          { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
          [
            makeServerSession(terminalRuntimeSessionId, 'term-111111111111111111111', {
              controller: { clientId: 'client_local', status: 'connected' },
            }),
          ],
          'client_local',
          new Map([
            [
              terminalRuntimeSessionId,
              {
                terminalRuntimeSessionId,
                terminalRuntimeGeneration: 1,
                snapshot: 'before-index',
                snapshotSeq: 1,
                outputEra: 0,
              },
            ],
          ]),
        )

        expect(hydrateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ terminalRuntimeSessionId, snapshot: 'before-index', snapshotSeq: 1, outputEra: 0 }),
          'snapshot',
        )
        expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]?.terminalSessionId).toBe(
          'term-111111111111111111111',
        )
      } finally {
        hydrateSpy.mockRestore()
      }
    })

    test('does not mark empty output payloads as terminal output activity', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        data: '',
        seq: 1,
        outputEra: 0,
        processName: 'bash',
      })
      vi.advanceTimersByTime(5000)
      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        data: '',
        seq: 2,
        outputEra: 0,
        processName: 'bash',
      })

      expect(handleOutputSpy).toHaveBeenCalledTimes(2)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
    })

    test('does not mark stale output payloads as terminal output activity', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'stale output',
        seq: 1,
        outputEra: 0,
        processName: 'bash',
      })

      expect(handleOutputSpy).not.toHaveBeenCalled()
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
    })

    test('dispatches title changes by terminalRuntimeSessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        canonicalTitle: 'new title',
      })
      expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')

      handleServerTitleSpy.mockClear()
      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        canonicalTitle: 'ignored',
      })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    // Regression: a background tab may see a `title` event before its
    // terminalRuntimeSessionId->terminalSessionId index entry exists locally (e.g. it
    // has never been attached/reconciled). `terminalSessionId` must be
    // used as the primary routing key, same as bell events, so title
    // updates for such tabs are not silently dropped.
    test('dispatches title changes by terminalSessionId even without a terminalRuntimeSessionId index entry', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')
      ;(projection as any).terminalSessionIdByTerminalRuntimeSessionId.delete('pty_session_a_aaaaaaaaa')

      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        canonicalTitle: 'new title',
      })
      expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')
    })

    test('ignores stale title changes for an old terminalRuntimeSessionId on the same terminalSessionId', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      projection.handleServerTitle({
        terminalRuntimeSessionId: 'pty_session_old_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        canonicalTitle: 'stale title',
      })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    test('dispatches exit by terminalRuntimeSessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

      projection.handleExit({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)

      handleExitSpy.mockClear()
      projection.handleExit({
        terminalRuntimeSessionId: 'pty_session_b_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-unroutedunroutedroute',
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      })
      expect(handleExitSpy).not.toHaveBeenCalled()
    })

    // Regression coverage for every realtime event type: a background tab
    // that has never been attached/reconciled locally may not yet have a
    // terminalRuntimeSessionId->terminalSessionId index entry. `terminalSessionId`
    // must be tried first for every dispatcher (mirroring the title-event
    // fix) so no realtime event type can silently drop updates for such a
    // tab. See `resolveSessionForRealtimeEvent`.
    test('routes output, exit, identity, and lifecycle by terminalSessionId even without a terminalRuntimeSessionId index entry', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')
      const handleIdentitySpy = vi.spyOn(session, 'handleIdentity')
      const handleLifecycleSpy = vi.spyOn(session, 'handleLifecycle')
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)
      ;(projection as any).terminalSessionIdByTerminalRuntimeSessionId.delete('pty_session_a_aaaaaaaaa')

      projection.handleOutput({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hello',
        seq: 1,
        outputEra: 0,
        processName: 'bash',
      })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      projection.handleIdentity({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,
      })
      expect(handleIdentitySpy).toHaveBeenCalledTimes(1)

      projection.handleLifecycle({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        phase: 'open',
        message: null,
        takeoverPending: false,
      })
      expect(handleLifecycleSpy).toHaveBeenCalledTimes(1)

      projection.handleExit({
        terminalRuntimeSessionId: 'pty_session_a_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
      })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('notify granularity', () => {
    test('notifySession invalidates worktree cache', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_a_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const listener = vi.fn()
      const unsubscribe = projection.subscribeTerminalWorktree(WORKTREE_KEY, listener)

      // Prime the cache
      projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      listener.mockClear()

      // Simulate metadata change via internal notifySession
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      ;(projection as any).notifySession(terminalSessionId)

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })
  })

  describe('reconcileServerSessions', () => {
    test('creates missing local sessions and syncs selection', () => {
      projection.setRepoIndex(makeRepoIndex())

      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const snapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(snapshot.count).toBe(1)
      expect(snapshot.sessions[0]!.terminalSessionId).toBe('term-111111111111111111111')
      expect(selectedChanges).toContainEqual({
        terminalWorktreeKey: WORKTREE_KEY,
        terminalSessionId: snapshot.sessions[0]!.terminalSessionId,
      })
    })

    test('removes orphaned local sessions', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionIdBefore = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [],
        'client_local',
        new Map(),
      )

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor resolves after server terminal resources close', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      let settled = false
      const closePromise = projection
        .closeTerminalByDescriptor(terminalSessionId, {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        })
        .then((result) => {
          settled = true
          return result
        })
      await Promise.resolve()

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        terminalSessionId,
      )
      expect(settled).toBe(false)

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(closePromise).resolves.toBe(true)
      expect(settled).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps command-closing sessions visible when server reconciliation removes them before close settles', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(
        projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
      ).toEqual([terminalSessionId])

      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [],
        'client_local',
        new Map(),
      )

      expect(
        projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
      ).toEqual([terminalSessionId])

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(closePromise).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps command-closing sessions visible when a session-closed event arrives before close settles', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId,
      })

      expect(
        projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.map((summary) => summary.terminalSessionId),
      ).toEqual([terminalSessionId])

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(closePromise).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('ignores a stale session-closed event after the durable terminal rebinds', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_2_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('uses the durable candidate for an exact close when the runtime reverse index is missing', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      ;(projection as any).terminalSessionIdByTerminalRuntimeSessionId.clear()

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('keeps an unknown runtime bell when a stale runtime close arrives', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.handleServerBell({
        terminalRuntimeSessionId: 'pty_session_2_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        processName: 'bash',
        canonicalTitle: null,
      })

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_2_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]?.hasBell).toBe(true)
    })

    test('clears an unknown runtime bell when its exact runtime close arrives', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.handleServerBell({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        repoRoot: REPO_ROOT,
        worktreePath: WORKTREE_PATH,
        processName: 'bash',
        canonicalTitle: null,
      })

      projection.handleSessionClosed({
        terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
      })
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]?.hasBell).toBe(false)
    })

    test('keeps a rebound runtime when an older command close settles', async () => {
      const terminalSessionId = 'term-111111111111111111111'
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
        'client_local',
        new Map(),
      )
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)
      const close = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_2_aaaaaaaaa', terminalSessionId)],
        'client_local',
        new Map(),
      )
      serverClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_1_aaaaaaaaa'))

      await expect(close).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      expect((projection as any).sessions.get(terminalSessionId)?.currentTerminalRuntimeSessionId()).toBe(
        'pty_session_2_aaaaaaaaa',
      )
    })

    test('does not reuse a pending close across repo runtime epochs', async () => {
      const terminalSessionId = 'term-111111111111111111111'
      const replacementRepoRuntimeId = 'repo-runtime-replacement'
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', terminalSessionId)],
        'client_local',
        new Map(),
      )
      const firstServerClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      const secondServerClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close
        .mockReturnValueOnce(firstServerClose.promise)
        .mockReturnValueOnce(secondServerClose.promise)

      const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      projection.setRepoIndex(makeRepoIndex(replacementRepoRuntimeId))
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: replacementRepoRuntimeId },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', terminalSessionId, {
            repoRuntimeId: replacementRepoRuntimeId,
          }),
        ],
        'client_local',
        new Map(),
      )
      const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: replacementRepoRuntimeId,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledTimes(2)
      firstServerClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_1_aaaaaaaaa'))
      await expect(firstClose).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)

      secondServerClose.resolve(successfulRuntimeCloseSnapshot(terminalSessionId, 'pty_session_2_aaaaaaaaa'))
      await expect(secondClose).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor selects an adjacent terminal after server close settles', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
          makeServerSession('pty_session_3_aaaaaaaaa', 'term-333333333333333333333'),
        ],
        'client_local',
        new Map(),
      )

      const activeSessionId = projection
        .terminalWorktreeSnapshot(WORKTREE_KEY)
        .sessions.find((session) => session.terminalSessionId === 'term-222222222222222222222')?.terminalSessionId
      if (!activeSessionId) throw new Error('missing term-222222222222222222222')
      projection.selectTerminal(WORKTREE_KEY, activeSessionId)
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const closePromise = projection.closeTerminalByDescriptor(activeSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      const closingSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(closingSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual([
        'term-111111111111111111111',
        'term-222222222222222222222',
        'term-333333333333333333333',
      ])
      expect(closingSnapshot.selectedDescriptor?.terminalSessionId).toBe('term-222222222222222222222')

      serverClose.resolve(successfulRuntimeCloseSnapshot(activeSessionId, 'pty_session_2_aaaaaaaaa'))
      await expect(closePromise).resolves.toBe(true)
      const closedSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(closedSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual([
        'term-111111111111111111111',
        'term-333333333333333333333',
      ])
      expect(closedSnapshot.selectedDescriptor?.terminalSessionId).toBe('term-333333333333333333333')
    })

    test('applies the exact close effect even when the workspace tabs snapshot is stale', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        ],
        'client_local',
        new Map(),
      )
      workspacePaneRuntimeMocks.writeSnapshot.mockResolvedValueOnce(false)
      workspacePaneRuntimeMocks.close.mockResolvedValueOnce(
        successfulRuntimeCloseSnapshot('term-111111111111111111111', 'pty_session_1_aaaaaaaaa'),
      )

      await expect(
        projection.closeTerminalByDescriptor('term-111111111111111111111', {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        }),
      ).resolves.toBe(true)

      expect(
        projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.map((session) => session.terminalSessionId),
      ).toEqual(['term-222222222222222222222'])
    })

    test('does not apply a stale close effect to a newly rebound runtime session', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_new_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      workspacePaneRuntimeMocks.close.mockResolvedValueOnce(
        successfulRuntimeCloseSnapshot('term-111111111111111111111', 'pty_session_old_aaaaaaaaa'),
      )

      await expect(
        projection.closeTerminalByDescriptor('term-111111111111111111111', {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        }),
      ).resolves.toBe(true)

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    })

    test('closeTerminalByDescriptor deduplicates repeated closes for the same terminal session', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)

      const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledTimes(1)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)

      serverClose.resolve(successfulRuntimeCloseSnapshot())
      await expect(firstClose).resolves.toBe(true)
      await expect(secondClose).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor keeps the session when server resource close fails', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const serverClose = Promise.withResolvers<ReturnType<typeof successfulRuntimeCloseSnapshot>>()
      workspacePaneRuntimeMocks.close.mockReturnValueOnce(serverClose.promise)
      const dispose = vi.spyOn(session, 'dispose')

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        repoRuntimeId: REPO_RUNTIME_ID,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)

      const expectation = expect(closePromise).resolves.toBe(false)
      serverClose.reject(new Error('close failed'))
      await expectation

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-111111111111111111111',
      )
      expect(dispose).not.toHaveBeenCalled()
    })

    test('completes a successful server close when local snapshot projection throws', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      workspacePaneRuntimeMocks.writeSnapshot.mockImplementationOnce(() => {
        throw new Error('local cache unavailable')
      })

      await expect(
        projection.closeTerminalByDescriptor(terminalSessionId, {
          repoRoot: REPO_ROOT,
          repoRuntimeId: REPO_RUNTIME_ID,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        }),
      ).resolves.toBe(true)

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
      expect(workspacePaneRuntimeMocks.refreshTabs).toHaveBeenCalledWith(REPO_ROOT, REPO_RUNTIME_ID)
    })

    test('closeTerminalByDescriptor rejects a mismatched repo runtime scope', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      workspacePaneRuntimeMocks.close.mockResolvedValueOnce({
        ok: false,
        runtimeType: 'terminal',
        message: 'error.repo-runtime-stale',
      })

      await expect(
        projection.closeTerminalByDescriptor(terminalSessionId, {
          repoRoot: REPO_ROOT,
          repoRuntimeId: 'repo-runtime-new',
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        }),
      ).resolves.toBe(false)

      expect(workspacePaneRuntimeMocks.close).toHaveBeenCalledOnce()
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    })

    test('preserves current selection and falls back to controller when current is lost', () => {
      projection.setRepoIndex(makeRepoIndex())

      // First reconcile: term-111111111111111111111 becomes current
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-111111111111111111111',
      )

      // Second reconcile: term-111111111111111111111 removed, term-222222222222222222222 is controller
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222', {
            controller: { clientId: 'client_local', status: 'connected' },
          }),
        ],
        'client_local',
        new Map(),
      )
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-222222222222222222222',
      )
    })

    test('closing the active terminal selects the adjacent tab in the server session list', () => {
      projection.setRepoIndex(makeRepoIndex())

      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_3_aaaaaaaaa', 'term-333333333333333333333'),
        ],
        'client_local',
        new Map(),
      )

      const snapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      const activeSessionId = snapshot.sessions.find(
        (session) => session.terminalSessionId === 'term-222222222222222222222',
      )?.terminalSessionId
      if (!activeSessionId) throw new Error('missing term-222222222222222222222')

      projection.selectTerminal(WORKTREE_KEY, activeSessionId)
      ;(projection as any).removeSession(activeSessionId, { dispose: false })

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe(
        'term-111111111111111111111',
      )
    })

    test('invalidates cached worktree snapshot when the server session list changes', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
        ],
        'client_local',
        new Map(),
      )

      const firstSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(firstSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual([
        'term-111111111111111111111',
        'term-222222222222222222222',
      ])

      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'term-222222222222222222222'),
          makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111'),
        ],
        'client_local',
        new Map(),
      )

      const secondSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(secondSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual([
        'term-222222222222222222222',
        'term-111111111111111111111',
      ])
    })
  })

  describe('snapshot cache', () => {
    test('returns cached snapshot without calling session.snapshot() repeatedly', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)

      // reconcile pre-populates the cache; clear it to test the caching path
      ;(projection as any).snapshotCache.delete(terminalSessionId)

      const snapshotSpy = vi.spyOn(session, 'snapshot')
      const s1 = projection.snapshot(terminalSessionId)
      const s2 = projection.snapshot(terminalSessionId)
      expect(s1).toBe(s2) // same reference
      expect(snapshotSpy).toHaveBeenCalledTimes(1)
    })

    test('invalidates snapshot cache on metadata notify', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
        [makeServerSession('pty_session_1_aaaaaaaaa', 'term-111111111111111111111')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const s1 = projection.snapshot(terminalSessionId)

      // metadata notify forces cache refresh
      ;(projection as any).notifySession(terminalSessionId, 'metadata')
      const s2 = projection.snapshot(terminalSessionId)
      expect(s1).not.toBe(s2)
    })
  })

  describe('singleton lifetime (P1.7)', () => {
    test('getTerminalSessionProjection returns the same instance across calls with the same deps', () => {
      // The session was filled by `beforeEach` with the per-test
      // `projection`. The getter must return that exact instance, not
      // construct a new one.
      const first = getTerminalSessionProjection({
        onSelectedWorktreeChange: () => {},
      })
      const second = getTerminalSessionProjection({
        onSelectedWorktreeChange: () => {},
      })
      expect(first).toBe(second)
      expect(first).toBe(projection)
    })

    test('setTerminalSessionProjectionForTests(null) clears the session so the next getter constructs a fresh instance', () => {
      const original = projection
      setTerminalSessionProjectionForTests(null)
      const fresh = getTerminalSessionProjection({
        onSelectedWorktreeChange: () => {},
      })
      expect(fresh).not.toBe(original)
      // Re-install for `afterEach` cleanup.
      setTerminalSessionProjectionForTests(projection)
    })

    test('destroy clears the singleton session when destroying the installed instance', () => {
      const original = getTerminalSessionProjection({
        onSelectedWorktreeChange: () => {},
      })
      expect(original).toBe(projection)

      original.destroy()

      const fresh = getTerminalSessionProjection({
        onSelectedWorktreeChange: () => {},
      })
      expect(fresh).not.toBe(original)
      fresh.destroy()
    })

    test('state added before a synthetic remount survives in the singleton session', () => {
      // Simulates the production invariant: Provider remounts
      // (StrictMode, route round-trip) reuse the singleton, so any
      // state injected before the remount is still visible after.
      projection.setRepoIndex(makeRepoIndex())
      const descriptor = makeDescriptor('term-111111111111111111111', 1)
      // Add a session via the internal API (no real WS, no
      // TerminalSession — just the projection bookkeeping).
      ;(projection as any).sessions.set(descriptor.terminalSessionId, {
        descriptor,
        snapshot: () => ({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null }),
        currentTerminalRuntimeSessionId: () => 'pty_session_1_aaaaaaaaa',
        dispose: () => {},
      })
      // Synthesize a remount: re-fetch the singleton via the
      // getter (the Provider's mount effect does exactly this).
      const after = getTerminalSessionProjection({
        onSelectedWorktreeChange: () => {},
      })
      expect(after).toBe(projection)
      // The session we injected is still in the projection's map —
      // i.e. the state survived the synthetic remount.
      const stored = (after as any).sessions.get(descriptor.terminalSessionId) as
        { descriptor: TerminalDescriptor } | undefined
      expect(stored?.descriptor.terminalSessionId).toBe('term-111111111111111111111')
    })
  })
})

describe('TerminalSessionProjection runtime binding activation races', () => {
  test('does not delete a durable session when the retiring generation exits during restart', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRepoIndex(makeRepoIndex())
    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [
        makeServerSession('pty_generation_race_aaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 1,
        }),
      ],
      'client_local',
      new Map(),
    )
    const session = (localProjection as any).sessions.get('term-111111111111111111111')
    session.restart()

    localProjection.handleExit({
      terminalRuntimeSessionId: 'pty_generation_race_aaaa',
      terminalRuntimeGeneration: 1,
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })

    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    localProjection.destroy()
  })

  test('consumes an exact future bell once when reconciliation activates its generation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRepoIndex(makeRepoIndex())
    localProjection.handleServerBell({
      terminalRuntimeSessionId: 'pty_future_bell_aaaaaaaa',
      terminalRuntimeGeneration: 2,
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: REPO_ROOT,
      worktreePath: WORKTREE_PATH,
      processName: 'zsh',
      canonicalTitle: null,
    })

    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [
        makeServerSession('pty_future_bell_aaaaaaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 2,
        }),
      ],
      'client_local',
      new Map(),
    )

    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).bellCount).toBe(1)
    expect((localProjection as any).pendingServerBellByRuntimeBindingKey.size).toBe(0)
    localProjection.destroy()
  })

  test('refuses to activate a future generation that exited before reconciliation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRepoIndex(makeRepoIndex())
    localProjection.handleExit({
      terminalRuntimeSessionId: 'pty_future_exit_aaaaaaaa',
      terminalRuntimeGeneration: 2,
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })

    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [
        makeServerSession('pty_future_exit_aaaaaaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 2,
        }),
      ],
      'client_local',
      new Map(),
    )

    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    localProjection.destroy()
  })

  test('ledgers a future-generation exit rejected by an active session until exact snapshot activation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRepoIndex(makeRepoIndex())
    const terminalSessionId = 'term-111111111111111111111'
    const terminalRuntimeSessionId = 'pty_active_future_aaaaaaaa'
    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
      new Map(),
    )

    localProjection.handleExit({
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 2,
      terminalSessionId,
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
      new Map(),
    )

    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    localProjection.destroy()
  })

  test('ledgers a future-generation exit rejected by an error session until exact snapshot activation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRepoIndex(makeRepoIndex())
    const terminalSessionId = 'term-111111111111111111111'
    const terminalRuntimeSessionId = 'pty_error_future_aaaaaaaaa'
    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
      new Map(),
    )
    const session = (localProjection as any).sessions.get(terminalSessionId)
    session.runtime.failRuntime('error.restart-failed')

    localProjection.handleExit({
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: 2,
      terminalSessionId,
      repoRoot: REPO_ROOT,
      repoRuntimeId: REPO_RUNTIME_ID,
    })
    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(terminalRuntimeSessionId, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
      new Map(),
    )

    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    localProjection.destroy()
  })
})

describe('TerminalSessionProjection direct runtime activation barrier', () => {
  test('consumes the exact future bell on direct authoritative activation', () => {
    const localProjection = new TerminalSessionProjection()
    localProjection.setRepoIndex(makeRepoIndex())
    localProjection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [
        makeServerSession('pty_direct_activation_aaaa', 'term-111111111111111111111', {
          terminalRuntimeGeneration: 1,
        }),
      ],
      'client_local',
      new Map(),
    )
    const session = (localProjection as any).sessions.get('term-111111111111111111111')
    const bellBase = {
      terminalRuntimeSessionId: 'pty_direct_activation_aaaa',
      terminalSessionId: 'term-111111111111111111111',
      repoRoot: REPO_ROOT,
      worktreePath: WORKTREE_PATH,
      processName: 'zsh',
      canonicalTitle: null,
    }
    localProjection.handleServerBell({ ...bellBase, terminalRuntimeGeneration: 2 })
    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).bellCount).toBe(0)

    session.hydrate({
      terminalRuntimeSessionId: 'pty_direct_activation_aaaa',
      terminalRuntimeGeneration: 2,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 80,
      canonicalRows: 24,
      snapshot: '',
      snapshotSeq: 0,
      outputEra: 0,
    })

    expect(localProjection.terminalWorktreeSnapshot(WORKTREE_KEY).bellCount).toBe(1)
    expect((localProjection as any).pendingServerBellByRuntimeBindingKey.size).toBe(0)
    localProjection.destroy()
  })
})

describe('TerminalSessionProjection new runtime lineage exit barrier', () => {
  const terminalSessionId = 'term-111111111111111111111'
  const lineageA = 'pty_lineage_a_aaaaaaaa'
  const lineageB = 'pty_lineage_b_aaaaaaaa'
  const lineageC = 'pty_lineage_c_aaaaaaaa'
  const exitFor = (terminalRuntimeSessionId: string) => ({
    terminalRuntimeSessionId,
    terminalRuntimeGeneration: 0,
    terminalSessionId,
    repoRoot: REPO_ROOT,
    repoRuntimeId: REPO_RUNTIME_ID,
  })

  function transitioningProjection(): { projection: TerminalSessionProjection; session: any } {
    const projection = new TerminalSessionProjection()
    projection.setRepoIndex(makeRepoIndex())
    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
      new Map(),
    )
    const session = (projection as any).sessions.get(terminalSessionId)
    session.restart()
    return { projection, session }
  }

  test('blocks direct activation when the replacement lineage exited before its attach response', () => {
    const { projection, session } = transitioningProjection()
    projection.handleExit(exitFor(lineageB))

    session.hydrate({
      terminalRuntimeSessionId: lineageB,
      terminalRuntimeGeneration: 0,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 80,
      canonicalRows: 24,
      snapshot: '',
      snapshotSeq: 0,
      outputEra: 0,
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('does not let a delayed partial create effect regress or replace a newer active binding', () => {
    const projection = new TerminalSessionProjection()
    projection.setRepoIndex(makeRepoIndex())
    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
      new Map(),
    )

    ;(projection as any).applyServerSessionEffect(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      1,
      makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 1 }),
      'client_local',
      new Map(),
    )
    ;(projection as any).applyServerSessionEffect(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      1,
      makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 }),
      'client_local',
      new Map(),
    )

    const session = (projection as any).sessions.get(terminalSessionId)
    expect(session.currentRuntimeBinding()).toEqual({
      terminalRuntimeSessionId: lineageA,
      terminalRuntimeGeneration: 2,
    })
    projection.destroy()
  })

  test('blocks reconciliation activation of an exited replacement lineage', () => {
    const { projection } = transitioningProjection()
    projection.handleExit(exitFor(lineageB))

    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 })],
      'client_local',
      new Map(),
    )

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('keeps unrelated lineage exits when exact activation commits lineage C', () => {
    const { projection, session } = transitioningProjection()
    projection.handleExit(exitFor(lineageB))

    session.hydrate({
      terminalRuntimeSessionId: lineageC,
      terminalRuntimeGeneration: 0,
      phase: 'open',
      message: null,
      processName: 'zsh',
      canonicalTitle: null,
      role: 'controller',
      controllerStatus: 'connected',
      canonicalCols: 80,
      canonicalRows: 24,
      snapshot: '',
      snapshotSeq: 0,
      outputEra: 0,
    })

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
    expect((projection as any).futureExitOrphans.blocksActivation(exitFor(lineageB))).toBe(true)
    projection.destroy()
  })

  test('blocks a different-lineage activation when its exit arrived while lineage A was active', () => {
    const projection = new TerminalSessionProjection()
    projection.setRepoIndex(makeRepoIndex())
    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 1 })],
      'client_local',
      new Map(),
    )
    projection.handleExit(exitFor(lineageB))

    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 })],
      'client_local',
      new Map(),
    )

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('preserves a generation 3 exit across generation 2 activation', () => {
    const { projection } = transitioningProjection()
    projection.handleExit({ ...exitFor(lineageA), terminalRuntimeGeneration: 3 })

    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
      new Map(),
    )
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)

    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 3 })],
      'client_local',
      new Map(),
    )
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('authoritative binding changes retire the older durable generation tombstone', () => {
    const { projection } = transitioningProjection()
    projection.handleExit({ ...exitFor(lineageA), terminalRuntimeGeneration: 3 })
    projection.handleExit({ ...exitFor(lineageA), terminalRuntimeGeneration: 2 })

    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 2 })],
      'client_local',
      new Map(),
    )
    expect((projection as any).futureExitOrphans.size()).toBe(2)

    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageA, terminalSessionId, { terminalRuntimeGeneration: 3 })],
      'client_local',
      new Map(),
    )
    expect((projection as any).futureExitOrphans.size()).toBe(1)
    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })

  test('keeps an orphan exit when an unrelated repo epoch is replaced', () => {
    const projection = new TerminalSessionProjection()
    const otherRepoRoot = '/repo-other'
    projection.setRepoIndex({
      ...makeRepoIndex(),
      [otherRepoRoot]: {
        repoRuntimeId: 'repo-runtime-other-1',
        branchByWorktreePath: { [otherRepoRoot]: 'main' },
      },
    })
    projection.handleExit(exitFor(lineageB))

    projection.setRepoIndex({
      ...makeRepoIndex(),
      [otherRepoRoot]: {
        repoRuntimeId: 'repo-runtime-other-2',
        branchByWorktreePath: { [otherRepoRoot]: 'main' },
      },
    })
    projection.reconcileServerSessions(
      { repoRoot: REPO_ROOT, repoRuntimeId: REPO_RUNTIME_ID },
      [makeServerSession(lineageB, terminalSessionId, { terminalRuntimeGeneration: 0 })],
      'client_local',
      new Map(),
    )

    expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    projection.destroy()
  })
})
