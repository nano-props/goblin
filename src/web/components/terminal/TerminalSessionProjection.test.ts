// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TerminalSessionProjection,
  getTerminalSessionProjection,
  setTerminalSessionProjectionForTests,
} from '#/web/components/terminal/TerminalSessionProjection.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-workspace-slot-key.ts'
import type { TerminalDescriptor, TerminalRepoIndex } from '#/web/components/terminal/types.ts'
import type { TerminalSessionSummary } from '#/shared/terminal-types.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { workspacePaneStaticTabOrderEntry, workspacePaneTerminalTabOrderEntry } from '#/shared/workspace-pane.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = formatTerminalWorktreeKey(REPO_ROOT, WORKTREE_PATH)

function makeDescriptor(sessionId: string, index: number): TerminalDescriptor {
  return {
    terminalKey: `${REPO_ROOT}\0${WORKTREE_PATH}\0${sessionId}`,
    terminalWorktreeKey: WORKTREE_KEY,
    sessionId,
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
  sessionId: string,
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
  const terminalKey = `${REPO_ROOT}\0${WORKTREE_PATH}\0${sessionId}`
  return {
    ptySessionId,
    terminalKey,
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
  let selectedChanges: Array<{ terminalWorktreeKey: string; terminalKey: string | null }>
  let removedSessions: Array<{ terminalKey: string; repoRoot: string; branch: string; worktreePath: string }>
  let materializedTerminalTabs: Array<{
    base: { repoRoot: string; branch: string; worktreePath: string }
    terminalKeys: string[]
  }>

  beforeEach(() => {
    resetReposStore()
    selectedChanges = []
    removedSessions = []
    materializedTerminalTabs = []
    projection = new TerminalSessionProjection(
      (terminalWorktreeKey, terminalKey) => selectedChanges.push({ terminalWorktreeKey, terminalKey }),
      (terminalKey, base) =>
        removedSessions.push({
          terminalKey,
          repoRoot: base.repoRoot,
          branch: base.branch,
          worktreePath: base.worktreePath,
        }),
      (base, terminalKeys) => materializedTerminalTabs.push({ base, terminalKeys: [...terminalKeys] }),
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
      const key = terminalWorktreeSnapshot.sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      projection.handleOutput({ ptySessionId: 'pty_session_b_aaaaaaaaa', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)
    })

    test('does not mark empty output payloads as terminal activity', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'))
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      projection.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: '', seq: 1, processName: 'bash' })
      vi.advanceTimersByTime(5000)
      projection.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: '', seq: 2, processName: 'bash' })

      expect(handleOutputSpy).toHaveBeenCalledTimes(2)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).activeCount).toBe(0)
    })

    test('dispatches title changes by ptySessionId index', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
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

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

      projection.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)

      handleExitSpy.mockClear()
      projection.handleExit({ ptySessionId: 'pty_session_b_aaaaaaaaa' })
      expect(handleExitSpy).not.toHaveBeenCalled()
    })

    test('handleExit invalidates the reattach snapshot cache for the exiting session', () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      // Seed the reattach cache directly so we can assert the exit
      // event is what removes the entry, not the local-session
      // cleanup.
      ;(projection as any).reattachSnapshotCache.set(key, {
        ptySessionId: 'pty_session_a_aaaaaaaaa',
        snapshot: 'cached',
        snapshotSeq: 7,
      })
      expect((projection as any).reattachSnapshotCache.has(key)).toBe(true)

      // Stub the local session's handleExit to return true so the
      // projection's existing discard path runs (the cache eviction
      // must not depend on it being absent, though).
      const session = (projection as any).sessions.get(key)
      vi.spyOn(session, 'handleExit').mockReturnValue(true)

      projection.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      expect((projection as any).reattachSnapshotCache.has(key)).toBe(false)
    })

    test('setReattachSnapshot evicts the oldest entry when the cache exceeds the safety cap', () => {
      // The cap is a safety net against bookkeeping drift (e.g. a
      // wedged server that never emits exit events). In normal use no
      // entry should be evicted, but if the cache somehow exceeds the
      // limit, the oldest entry is dropped.
      const limit = (TerminalSessionProjection as unknown as { REATTACH_SNAPSHOT_CACHE_HARD_CAP: number })
        .REATTACH_SNAPSHOT_CACHE_HARD_CAP

      for (let i = 0; i < limit + 1; i++) {
        ;(projection as any).setReattachSnapshot(`key-${i}`, {
          ptySessionId: `session-${i}`,
          snapshot: `snap-${i}`,
          snapshotSeq: i,
        })
      }
      expect((projection as any).reattachSnapshotCache.size).toBe(limit)
      expect((projection as any).reattachSnapshotCache.has('key-0')).toBe(false)
      expect((projection as any).reattachSnapshotCache.has(`key-${limit}`)).toBe(true)
    })

    test('T2.1: reattach snapshot cap is 8 (was 32, sized for multi-tenant)', () => {
      // The cap is a single-user tuning knob. 8 is well above the
      // typical 1-3 detached sessions a single user has at any time
      // (occasional 5), and caps worst-case reattach memory at
      // ~16 MiB (8 × 2 MiB per snapshot, which is itself an upper
      // bound). Raising this back toward 32 (the old multi-tenant
      // value) is a deliberate decision and should not happen
      // silently — if a future change moves it, this test forces a
      // conversation.
      const cap = (TerminalSessionProjection as unknown as { REATTACH_SNAPSHOT_CACHE_HARD_CAP: number })
        .REATTACH_SNAPSHOT_CACHE_HARD_CAP
      expect(cap).toBe(8)
    })

    test('handleExit preserves the reattach cache when the local session rejects the exit', () => {
      // Race scenario: the server emitted an exit for an old
      // ptySessionId, but the local session has already been updated to
      // a new ptySessionId (e.g., after a server-side restart). The
      // sessionKeyByPtySessionId index may still map the old ptySessionId
      // to the local key. Evicting the reattach cache here would
      // discard a snapshot the user can still use on next reattach.
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      // Local session is alive under a *different* ptySessionId.
      session.currentPtySessionId = () => 'pty_session_b_aaaaaaaaa'
      session.handleExit = vi.fn().mockReturnValue(false)

      // Seed the reattach cache for the old ptySessionId.
      ;(projection as any).reattachSnapshotCache.set(key, {
        ptySessionId: 'pty_session_a_aaaaaaaaa',
        snapshot: 'cached',
        snapshotSeq: 7,
      })
      expect((projection as any).reattachSnapshotCache.has(key)).toBe(true)

      projection.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      // Cache survives — the local session didn't confirm the exit.
      expect((projection as any).reattachSnapshotCache.has(key)).toBe(true)
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
      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      ;(projection as any).notifySession(key)

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
      expect(snapshot.sessions[0]!.sessionId).toBe('session-1')
      expect(selectedChanges).toContainEqual({
        terminalWorktreeKey: WORKTREE_KEY,
        terminalKey: snapshot.sessions[0]!.terminalKey,
      })
      expect(materializedTerminalTabs).toContainEqual({
        base: { repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH },
        terminalKeys: [snapshot.sessions[0]!.terminalKey],
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

      const keyBefore = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      expect(projection.isKnownSession(keyBefore)).toBe(true)

      projection.reconcileServerSessions(REPO_ROOT, [], 'client_local', new Map())

      expect(projection.isKnownSession(keyBefore)).toBe(false)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
      expect(removedSessions).toEqual([
        { terminalKey: keyBefore, repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH },
      ])
    })

    test('session removal callback removes the owned workspace pane tab', async () => {
      const descriptor = makeDescriptor('session-1', 1)
      seedRepoState({
        id: REPO_ROOT,
        branches: [createRepoBranch(BRANCH, { worktree: { path: WORKTREE_PATH } })],
        selectedBranch: BRANCH,
        workspacePaneTabOrderByBranch: {
          [BRANCH]: [
            workspacePaneStaticTabOrderEntry('status'),
            workspacePaneTerminalTabOrderEntry(descriptor.terminalKey),
            workspacePaneStaticTabOrderEntry('history'),
          ],
        },
      })
      const registryWithStore = new TerminalSessionProjection(
        () => {},
        (key, base) => {
          useReposStore.getState().removeWorkspacePaneTerminalTab(base.repoRoot, key, base.branch)
        },
      )
      try {
        registryWithStore.setRepoIndex(makeRepoIndex())
        registryWithStore.reconcileServerSessions(
          REPO_ROOT,
          [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
          'client_local',
          new Map(),
        )
        const session = (registryWithStore as any).sessions.get(descriptor.terminalKey)
        vi.spyOn(session, 'closeServerResourcesAndWait').mockResolvedValue(undefined)

        await registryWithStore.closeTerminalByDescriptor(descriptor.terminalKey, descriptor)

        const repo = useReposStore.getState().repos[REPO_ROOT]
        expect(repo ? workspacePaneTabOrderForBranch(repo.ui, BRANCH) : []).toEqual([
          workspacePaneStaticTabOrderEntry('status'),
          workspacePaneStaticTabOrderEntry('history'),
        ])
      } finally {
        registryWithStore.destroy()
      }
    })

    test('session removal callback failures do not block terminal disposal', async () => {
      const registryWithThrowingCallback = new TerminalSessionProjection(
        () => {},
        () => {
          throw new Error('store write failed')
        },
      )
      try {
        registryWithThrowingCallback.setRepoIndex(makeRepoIndex())
        registryWithThrowingCallback.reconcileServerSessions(
          REPO_ROOT,
          [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
          'client_local',
          new Map(),
        )
        const key = registryWithThrowingCallback.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
        const session = (registryWithThrowingCallback as any).sessions.get(key)
        const closeServerResourcesAndWait = vi
          .spyOn(session, 'closeServerResourcesAndWait')
          .mockResolvedValue(undefined)
        const dispose = vi.spyOn(session, 'dispose').mockImplementation(() => {})

        await expect(
          registryWithThrowingCallback.closeTerminalByDescriptor(key, {
            repoRoot: REPO_ROOT,
            branch: BRANCH,
            worktreePath: WORKTREE_PATH,
          }),
        ).resolves.toBe(true)

        expect(closeServerResourcesAndWait).toHaveBeenCalled()
        expect(dispose).toHaveBeenCalledWith({ closeSession: false })
        expect(registryWithThrowingCallback.isKnownSession(key)).toBe(false)
      } finally {
        registryWithThrowingCallback.destroy()
      }
    })

    test('closeTerminalByDescriptor resolves after server terminal resources close', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      let resolveClose!: () => void
      vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve
          }),
      )

      let settled = false
      const closePromise = projection
        .closeTerminalByDescriptor(key, {
          repoRoot: REPO_ROOT,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        })
        .then((result) => {
          settled = true
          return result
        })
      await Promise.resolve()

      expect(projection.isKnownSession(key)).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor).toBeNull()
      expect(settled).toBe(false)

      resolveClose()
      await expect(closePromise).resolves.toBe(true)
      expect(settled).toBe(true)
      expect(projection.isKnownSession(key)).toBe(false)
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
        .sessions.find((session) => session.sessionId === 'session-2')?.terminalKey
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
      expect(closingSnapshot.sessions.map((item) => item.sessionId)).toEqual(['session-1', 'session-3'])
      expect(closingSnapshot.selectedDescriptor?.sessionId).toBe('session-3')

      resolveClose()
      await expect(closePromise).resolves.toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions.map((item) => item.sessionId)).toEqual([
        'session-1',
        'session-3',
      ])
    })

    test('closeTerminalByDescriptor deduplicates repeated closes for the same terminal key', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      let resolveClose!: () => void
      const closeServerResourcesAndWait = vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve
          }),
      )

      const firstClose = projection.closeTerminalByDescriptor(key, {
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      const secondClose = projection.closeTerminalByDescriptor(key, {
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
      expect(projection.isKnownSession(key)).toBe(false)
    })

    test('closeTerminalByDescriptor keeps the session when server resource close fails', async () => {
      projection.setRepoIndex(makeRepoIndex())
      projection.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'session-1')],
        'client_local',
        new Map(),
      )
      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)
      let rejectClose!: (error: Error) => void
      vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rejectClose = reject
          }),
      )
      const dispose = vi.spyOn(session, 'dispose')

      const closePromise = projection.closeTerminalByDescriptor(key, {
        repoRoot: REPO_ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE_PATH,
      })
      await Promise.resolve()

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(0)

      const expectation = expect(closePromise).resolves.toBe(false)
      rejectClose(new Error('close failed'))
      await expectation

      expect(projection.isKnownSession(key)).toBe(true)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).count).toBe(1)
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.sessionId).toBe('session-1')
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
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.sessionId).toBe('session-1')

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
      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.sessionId).toBe('session-2')
    })

    test('closing the active terminal selects the adjacent tab in server order', () => {
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
      const activeKey = snapshot.sessions.find((session) => session.sessionId === 'session-2')?.terminalKey
      if (!activeKey) throw new Error('missing session-2')

      projection.selectTerminal(WORKTREE_KEY, activeKey)
      ;(projection as any).removeSession(activeKey, { dispose: false, closeSession: false })

      expect(projection.terminalWorktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.sessionId).toBe('session-1')
    })

    test('invalidates cached worktree snapshot when server order changes', () => {
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
      expect(firstSnapshot.sessions.map((session) => session.sessionId)).toEqual(['session-1', 'session-2'])

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
      expect(secondSnapshot.sessions.map((session) => session.sessionId)).toEqual(['session-2', 'session-1'])
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

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const session = (projection as any).sessions.get(key)

      // reconcile pre-populates the cache; clear it to test the caching path
      ;(projection as any).snapshotCache.delete(key)

      const snapshotSpy = vi.spyOn(session, 'snapshot')
      const s1 = projection.snapshot(key)
      const s2 = projection.snapshot(key)
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

      const key = projection.terminalWorktreeSnapshot(WORKTREE_KEY).sessions[0]!.terminalKey
      const s1 = projection.snapshot(key)

      // metadata notify forces cache refresh
      ;(projection as any).notifySession(key, 'metadata')
      const s2 = projection.snapshot(key)
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
      ;(projection as any).sessions.set(descriptor.terminalKey, {
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
      const stored = (after as any).sessions.get(descriptor.terminalKey) as
        { descriptor: TerminalDescriptor } | undefined
      expect(stored?.descriptor.sessionId).toBe('session-1')
    })
  })
})
