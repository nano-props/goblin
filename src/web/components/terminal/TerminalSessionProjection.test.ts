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
import { resetReposStore } from '#/web/test-utils/bridge.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = formatTerminalWorktreeKey(REPO_ROOT, WORKTREE_PATH)

function makeDescriptor(terminalSessionId: string, index: number): TerminalDescriptor {
  return {
    terminalSessionId,
    terminalWorktreeKey: WORKTREE_KEY,
    index,
    repoRoot: REPO_ROOT,
    branch: BRANCH,
    worktreePath: WORKTREE_PATH,
  }
}

function makeRepoIndex(): TerminalRepoIndex {
  return {
    [REPO_ROOT]: {
      instanceToken: 1,
      branchByWorktreePath: { [WORKTREE_PATH]: BRANCH },
    },
  }
}

function makeServerSession(
  ptySessionId: string,
  terminalSessionId: string,
  overrides: Partial<{
    controller: { clientId: string; status: 'connected' }
    processName: string
    canonicalTitle: string | null
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    cols: number
    rows: number
  }> = {},
): TerminalSessionSummary {
  return {
    ptySessionId,
    terminalSessionId,
    repoRoot: REPO_ROOT,
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

describe('TerminalSessionProjection', () => {
  let projection: TerminalSessionProjection
  let selectedChanges: Array<{ terminalWorktreeKey: string; terminalSessionId: string | null }>

  beforeEach(() => {
    resetReposStore()
    selectedChanges = []
    projection = new TerminalSessionProjection(
      (terminalWorktreeKey, terminalSessionId) => selectedChanges.push({ terminalWorktreeKey, terminalSessionId }),
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

  describe('event dispatch', () => {
    test('dispatches output to the correct session by ptySessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const terminalWorktreeSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      const terminalSessionId = terminalWorktreeSnapshot.sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      projection.handleOutput({ ptySessionId: 'pty_session_b_aaaaaaaaa', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)
    })

    test('recovers output that arrived before the pty index through the next server snapshot', () => {
      projection.setRepoIndex(makeRepoIndex())
      const ptySessionId = 'pty_session_late_aaaaaaaaa'
      const hydrateSpy = vi.spyOn(TerminalSession.prototype, 'hydrate')

      try {
        projection.handleOutput({ ptySessionId, data: 'before-index', seq: 1, processName: 'bash' })
        expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions).toEqual([])

        projection.reconcileServerSessions(
          REPO_ROOT,
          [
            makeServerSession(ptySessionId, 'session-1', {
              controller: { clientId: 'client_local', status: 'connected' },
            }),
          ],
          'client_local',
          new Map([[ptySessionId, { ptySessionId, snapshot: 'before-index', snapshotSeq: 1 }]]),
        )

        expect(hydrateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ ptySessionId, snapshot: 'before-index', snapshotSeq: 1 }),
        )
        expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]?.terminalSessionId).toBe('session-1')
      } finally {
        hydrateSpy.mockRestore()
      }
    })

    test('does not mark empty output payloads as terminal output activity', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: '', seq: 1, processName: 'bash' })
      vi.advanceTimersByTime(5000)
      projection.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: '', seq: 2, processName: 'bash' })

      expect(handleOutputSpy).toHaveBeenCalledTimes(2)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).outputActiveCount).toBe(0)
    })

    test('dispatches title changes by ptySessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      projection.handleServerTitle({ ptySessionId: 'pty_session_a_aaaaaaaaa', canonicalTitle: 'new title' })
      expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')

      handleServerTitleSpy.mockClear()
      projection.handleServerTitle({ ptySessionId: 'pty_session_b_aaaaaaaaa', canonicalTitle: 'ignored' })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    test('dispatches exit by ptySessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

      projection.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)

      handleExitSpy.mockClear()
      projection.handleExit({ ptySessionId: 'pty_session_b_aaaaaaaaa' })
      expect(handleExitSpy).not.toHaveBeenCalled()
    })

  })

  describe('notify granularity', () => {
    test('notifySession invalidates worktree cache', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
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
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const snapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(snapshot.count).toBe(1)
      expect(snapshot.sessions[0]!.terminalSessionId).toBe('session-1')
      expect(selectedChanges).toContainEqual({
        terminalWorktreeKey: WORKTREE_KEY,
        terminalSessionId: snapshot.sessions[0]!.terminalSessionId,
      })
    })

    test('removes orphaned local sessions', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const terminalSessionIdBefore = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      expect(projection.isKnownSession(terminalSessionIdBefore)).toBe(true)

      projection.reconcileServerSessions(REPO_ROOT, [], 'client_local', new Map())

      expect(projection.isKnownSession(terminalSessionIdBefore)).toBe(false)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('closeTerminalByDescriptor resolves after server terminal resources close', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      let resolveClose!: () => void
      vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve
          }),
      )

      let settled = false
      const closePromise = projection
        .closeTerminalByDescriptor(terminalSessionId, {
          repoRoot: REPO_ROOT,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        })
        .then((result) => {
          settled = true
          return result
        })
      await Promise.resolve()

      expect(projection.isKnownSession(terminalSessionId)).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor).toBeNull()
      expect(settled).toBe(false)

      resolveClose()
      await expect(closePromise).resolves.toBe(true)
      expect(settled).toBe(true)
      expect(projection.isKnownSession(terminalSessionId)).toBe(false)
    })

    test('closeTerminalByDescriptor selects an adjacent terminal before server close settles', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'session-1'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'session-2'),
          makeServerSession('pty_session_3_aaaaaaaaa', 'session-3'),
        ],
        'client_local',
        new Map(),
      )

      const activeKey = projection
        .terminalWorktreeSnapshot(WORKTREE_KEY)
        .sessions.find((session) => session.terminalSessionId === 'session-2')?.terminalSessionId
      if (!activeKey) throw new Error('missing session-2')
      projection.selectTerminal(WORKTREE_KEY, activeKey)
      const session = (projection as any).sessions.get(activeKey)
      let resolveClose!: () => void
      vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve
          }),
      )

      const closePromise = projection.closeTerminalByDescriptor(activeKey, {
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      const closingSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(closingSnapshot.sessions.map((item) => item.terminalSessionId)).toEqual(['session-1', 'session-3'])
      expect(closingSnapshot.selectedDescriptor?.terminalSessionId).toBe('session-3')

      resolveClose()
      await expect(closePromise).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.map((item) => item.terminalSessionId)).toEqual([
        'session-1',
        'session-3',
      ])
    })

    test('closeTerminalByDescriptor deduplicates repeated closes for the same terminal session', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      let resolveClose!: () => void
      const closeServerResourcesAndWait = vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve
          }),
      )

      const firstClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      const secondClose = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(closeServerResourcesAndWait).toHaveBeenCalledTimes(1)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)

      resolveClose()
      await expect(firstClose).resolves.toBe(true)
      await expect(secondClose).resolves.toBe(true)
      expect(projection.isKnownSession(terminalSessionId)).toBe(false)
    })

    test('closeTerminalByDescriptor keeps the session when server resource close fails', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      const terminalSessionId = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalSessionId
      const session = (projection as any).sessions.get(terminalSessionId)
      let rejectClose!: (error: Error) => void
      vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rejectClose = reject
          }),
      )
      const dispose = vi.spyOn(session, 'dispose')

      const closePromise = projection.closeTerminalByDescriptor(terminalSessionId, {
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)

      const expectation = expect(closePromise).resolves.toBe(false)
      rejectClose(new Error('close failed'))
      await expectation

      expect(projection.isKnownSession(terminalSessionId)).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe('session-1')
      expect(dispose).not.toHaveBeenCalled()
    })

    test('preserves current selection and falls back to controller when current is lost', () => {
      projection.setRepoIndex(makeRepoIndex())

      // First reconcile: session-1 becomes current
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe('session-1')

      // Second reconcile: session-1 removed, session-2 is controller
      projection.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'session-2', {
            controller: { clientId: 'client_local', status: 'connected' },
          }),
        ],
        'client_local',
        new Map(),
      )
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe('session-2')
    })

    test('closing the active terminal selects the adjacent tab in the server session list', () => {
      projection.setRepoIndex(makeRepoIndex())

      projection.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'session-2'),
          makeServerSession('pty_session_1_aaaaaaaaa', 'session-1'),
          makeServerSession('pty_session_3_aaaaaaaaa', 'session-3'),
        ],
        'client_local',
        new Map(),
      )

      const snapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      const activeKey = snapshot.sessions.find((session) => session.terminalSessionId === 'session-2')?.terminalSessionId
      if (!activeKey) throw new Error('missing session-2')

      projection.selectTerminal(WORKTREE_KEY, activeKey)
      ;(projection as any).removeSession(activeKey, { dispose: false, closeSession: false })

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalSessionId).toBe('session-1')
    })

    test('invalidates cached worktree snapshot when the server session list changes', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'session-1'),
          makeServerSession('pty_session_2_aaaaaaaaa', 'session-2'),
        ],
        'client_local',
        new Map(),
      )

      const firstSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(firstSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual(['session-1', 'session-2'])

      projection.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'session-2'),
          makeServerSession('pty_session_1_aaaaaaaaa', 'session-1'),
        ],
        'client_local',
        new Map(),
      )

      const secondSnapshot = projection.terminalWorktreeSnapshot(WORKTREE_KEY)
      expect(secondSnapshot.sessions.map((session) => session.terminalSessionId)).toEqual(['session-2', 'session-1'])
    })
  })

  describe('snapshot cache', () => {
    test('returns cached snapshot without calling session.snapshot() repeatedly', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
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
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
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
      const descriptor = makeDescriptor('session-1', 1)
      // Add a session via the internal API (no real WS, no
      // TerminalSession — just the projection bookkeeping).
      ;(projection as any).sessions.set(descriptor.terminalSessionId, {
        descriptor,
        snapshot: () => ({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null }),
        currentPtySessionId: () => 'pty_session_1_aaaaaaaaa',
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
      expect(stored?.descriptor.terminalSessionId).toBe('session-1')
    })
  })
})
