// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalSessionRegistry } from '#/web/components/terminal/TerminalSessionRegistry.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import type { TerminalDescriptor, TerminalRepoIndex } from '#/web/components/terminal/types.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = worktreeTerminalKey(REPO_ROOT, WORKTREE_PATH)

function makeDescriptor(terminalId: string, index: number): TerminalDescriptor {
  return {
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0${terminalId}`,
    worktreeTerminalKey: WORKTREE_KEY,
    terminalId,
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
  sessionId: string,
  terminalId: string,
  overrides: Partial<{
    controller: { attachmentId: string; status: 'connected' | 'grace' }
    processName: string
    canonicalTitle: string | null
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    cols: number
    rows: number
    displayOrder: number
  }> = {},
) {
  return {
    sessionId,
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0${terminalId}`,
    cwd: WORKTREE_PATH,
    controller: overrides.controller ?? null,
    processName: overrides.processName ?? 'bash',
    canonicalTitle: overrides.canonicalTitle ?? null,
    phase: overrides.phase ?? 'open',
    message: overrides.message ?? null,
    cols: overrides.cols ?? 80,
    rows: overrides.rows ?? 24,
    displayOrder: overrides.displayOrder ?? 1,
  }
}

describe('TerminalSessionRegistry', () => {
  let registry: TerminalSessionRegistry
  let selectedChanges: Array<{ worktreeTerminalKey: string; key: string | null }>

  beforeEach(() => {
    selectedChanges = []
    registry = new TerminalSessionRegistry(
      () => REPO_ROOT,
      (worktreeTerminalKey, key) => selectedChanges.push({ worktreeTerminalKey, key }),
    )
  })

  afterEach(() => {
    registry.destroy()
  })

  describe('event dispatch', () => {
    test('dispatches output to the correct session by sessionId index', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const worktreeSnapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      const key = worktreeSnapshot.sessions[0]!.key
      const session = (registry as any).sessions.get(key)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      registry.handleOutput({ sessionId: 'session-a', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      registry.handleOutput({ sessionId: 'session-b', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)
    })

    test('dispatches title changes by sessionId index', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      const session = (registry as any).sessions.get(key)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      registry.handleServerTitle({ sessionId: 'session-a', canonicalTitle: 'new title' })
      expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')

      handleServerTitleSpy.mockClear()
      registry.handleServerTitle({ sessionId: 'session-b', canonicalTitle: 'ignored' })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    test('dispatches exit by sessionId index', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      const session = (registry as any).sessions.get(key)
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

      registry.handleExit({ sessionId: 'session-a' })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)

      handleExitSpy.mockClear()
      registry.handleExit({ sessionId: 'session-b' })
      expect(handleExitSpy).not.toHaveBeenCalled()
    })

    test('handleExit invalidates the reattach snapshot cache for the exiting session', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      // Seed the reattach cache directly so we can assert the exit
      // event is what removes the entry, not the local-session
      // cleanup.
      ;(registry as any).reattachSnapshotCache.set(key, {
        sessionId: 'session-a',
        snapshot: 'cached',
        snapshotSeq: 7,
      })
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(true)

      // Stub the local session's handleExit to return true so the
      // registry's existing discard path runs (the cache eviction
      // must not depend on it being absent, though).
      const session = (registry as any).sessions.get(key)
      vi.spyOn(session, 'handleExit').mockReturnValue(true)

      registry.handleExit({ sessionId: 'session-a' })
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(false)
    })

    test('setReattachSnapshot evicts the oldest entry when the cache exceeds the safety cap', () => {
      // The cap is a safety net against bookkeeping drift (e.g. a
      // wedged server that never emits exit events). In normal use no
      // entry should be evicted, but if the cache somehow exceeds the
      // limit, the oldest entry is dropped.
      const limit = (TerminalSessionRegistry as unknown as { REATTACH_SNAPSHOT_CACHE_HARD_CAP: number })
        .REATTACH_SNAPSHOT_CACHE_HARD_CAP

      for (let i = 0; i < limit + 1; i++) {
        ;(registry as any).setReattachSnapshot(`key-${i}`, {
          sessionId: `session-${i}`,
          snapshot: `snap-${i}`,
          snapshotSeq: i,
        })
      }
      expect((registry as any).reattachSnapshotCache.size).toBe(limit)
      expect((registry as any).reattachSnapshotCache.has('key-0')).toBe(false)
      expect((registry as any).reattachSnapshotCache.has(`key-${limit}`)).toBe(true)
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
      const cap = (TerminalSessionRegistry as unknown as { REATTACH_SNAPSHOT_CACHE_HARD_CAP: number })
        .REATTACH_SNAPSHOT_CACHE_HARD_CAP
      expect(cap).toBe(8)
    })

    test('handleExit preserves the reattach cache when the local session rejects the exit', () => {
      // Race scenario: the server emitted an exit for an old
      // sessionId, but the local session has already been updated to
      // a new sessionId (e.g., after a server-side restart). The
      // sessionKeyBySessionId index may still map the old sessionId
      // to the local key. Evicting the reattach cache here would
      // discard a snapshot the user can still use on next reattach.
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      const session = (registry as any).sessions.get(key)
      // Local session is alive under a *different* sessionId.
      session.currentSessionId = () => 'session-b'
      session.handleExit = vi.fn().mockReturnValue(false)

      // Seed the reattach cache for the old sessionId.
      ;(registry as any).reattachSnapshotCache.set(key, {
        sessionId: 'session-a',
        snapshot: 'cached',
        snapshotSeq: 7,
      })
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(true)

      registry.handleExit({ sessionId: 'session-a' })
      // Cache survives — the local session didn't confirm the exit.
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(true)
    })
  })

  describe('notify granularity', () => {
    test('metadata notify invalidates worktree cache', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const listener = vi.fn()
      const unsubscribe = registry.subscribeWorktree(WORKTREE_KEY, listener)

      // Prime the cache
      registry.worktreeSnapshot(WORKTREE_KEY)
      listener.mockClear()

      // Simulate metadata change via internal notifySession
      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      ;(registry as any).notifySession(key, 'metadata')

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })

    test('outputSummary notify does NOT invalidate worktree cache', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-a', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const listener = vi.fn()
      const unsubscribe = registry.subscribeWorktree(WORKTREE_KEY, listener)

      // Prime the cache
      registry.worktreeSnapshot(WORKTREE_KEY)
      listener.mockClear()

      // Simulate outputSummary change
      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      ;(registry as any).notifySession(key, 'outputSummary')

      expect(listener).not.toHaveBeenCalled()
      unsubscribe()
    })
  })

  describe('reconcileServerSessions', () => {
    test('creates missing local sessions and syncs selection', () => {
      registry.setRepoIndex(makeRepoIndex())

      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-1', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const snapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      expect(snapshot.count).toBe(1)
      expect(snapshot.sessions[0]!.terminalId).toBe('terminal-1')
      expect(selectedChanges).toContainEqual({ worktreeTerminalKey: WORKTREE_KEY, key: snapshot.sessions[0]!.key })
    })

    test('removes orphaned local sessions', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-1', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const keyBefore = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      expect(registry.isKnownSession(keyBefore)).toBe(true)

      registry.reconcileServerSessions(REPO_ROOT, [], 'attachment_local', new Map())

      expect(registry.isKnownSession(keyBefore)).toBe(false)
      expect(registry.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)
    })

    test('preserves current selection and falls back to controller when current is lost', () => {
      registry.setRepoIndex(makeRepoIndex())

      // First reconcile: terminal-1 becomes current
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-1', 'terminal-1')],
        'attachment_local',
        new Map(),
      )
      expect(registry.worktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalId).toBe('terminal-1')

      // Second reconcile: terminal-1 removed, terminal-2 is controller
      registry.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('session-2', 'terminal-2', {
            controller: { attachmentId: 'attachment_local', status: 'connected' },
          }),
        ],
        'attachment_local',
        new Map(),
      )
      expect(registry.worktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalId).toBe('terminal-2')
    })

    test('closing the active terminal selects the adjacent tab in display order', () => {
      registry.setRepoIndex(makeRepoIndex())

      registry.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('session-1', 'terminal-1', { displayOrder: 1 }),
          makeServerSession('session-2', 'terminal-2', { displayOrder: 0 }),
          makeServerSession('session-3', 'terminal-3', { displayOrder: 2 }),
        ],
        'attachment_local',
        new Map(),
      )

      const snapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      const activeKey = snapshot.sessions.find((session) => session.terminalId === 'terminal-2')?.key
      if (!activeKey) throw new Error('missing terminal-2')

      registry.selectTerminal(WORKTREE_KEY, activeKey)
      ;(registry as any).removeSession(activeKey, { dispose: false, closeSession: false })

      expect(registry.worktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.terminalId).toBe('terminal-1')
    })

    test('invalidates cached worktree snapshot when server display order changes', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('session-1', 'terminal-1', { displayOrder: 0 }),
          makeServerSession('session-2', 'terminal-2', { displayOrder: 1 }),
        ],
        'attachment_local',
        new Map(),
      )

      const firstSnapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      expect(firstSnapshot.sessions.map((session) => session.terminalId)).toEqual(['terminal-1', 'terminal-2'])

      registry.reconcileServerSessions(
        REPO_ROOT,
        [
          makeServerSession('session-1', 'terminal-1', { displayOrder: 1 }),
          makeServerSession('session-2', 'terminal-2', { displayOrder: 0 }),
        ],
        'attachment_local',
        new Map(),
      )

      const secondSnapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      expect(secondSnapshot.sessions.map((session) => session.terminalId)).toEqual(['terminal-2', 'terminal-1'])
    })
  })

  describe('snapshot cache', () => {
    test('returns cached snapshot without calling session.snapshot() repeatedly', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-1', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      const session = (registry as any).sessions.get(key)

      // reconcile pre-populates the cache; clear it to test the caching path
      ;(registry as any).snapshotCache.delete(key)

      const snapshotSpy = vi.spyOn(session, 'snapshot')
      const s1 = registry.snapshot(key)
      const s2 = registry.snapshot(key)
      expect(s1).toBe(s2) // same reference
      expect(snapshotSpy).toHaveBeenCalledTimes(1)
    })

    test('invalidates snapshot cache on metadata notify', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSessions(
        REPO_ROOT,
        [makeServerSession('session-1', 'terminal-1')],
        'attachment_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).sessions[0]!.key
      const s1 = registry.snapshot(key)

      // metadata notify forces cache refresh
      ;(registry as any).notifySession(key, 'metadata')
      const s2 = registry.snapshot(key)
      expect(s1).not.toBe(s2)
    })
  })
})
