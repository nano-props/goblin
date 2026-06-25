// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  TerminalSlotRegistry,
  getTerminalSlotRegistry,
  setTerminalSlotRegistryForTests,
} from '#/web/components/terminal/TerminalSlotRegistry.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import type { TerminalDescriptor, TerminalRepoIndex } from '#/web/components/terminal/types.ts'
import type { TerminalSlotSummary } from '#/shared/terminal-types.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { workspacePaneStaticTabOrderEntry, workspacePaneTerminalTabOrderEntry } from '#/shared/workspace-pane.ts'

const REPO_ROOT = '/repo'
const WORKTREE_PATH = '/repo'
const BRANCH = 'main'
const WORKTREE_KEY = worktreeTerminalKey(REPO_ROOT, WORKTREE_PATH)

function makeDescriptor(slotId: string, index: number): TerminalDescriptor {
  return {
    key: `${REPO_ROOT}\0${WORKTREE_PATH}\0${slotId}`,
    worktreeTerminalKey: WORKTREE_KEY,
    slotId,
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
  slotId: string,
  overrides: Partial<{
    controller: { clientId: string; status: 'connected' }
    processName: string
    canonicalTitle: string | null
    phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
    message: string | null
    cols: number
    rows: number
    displayOrder: number
  }> = {},
): TerminalSlotSummary {
  const key = `${REPO_ROOT}\0${WORKTREE_PATH}\0${slotId}`
  return {
    ptySessionId,
    key,
    viewType: 'terminal',
    viewId: key,
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

describe('TerminalSlotRegistry', () => {
  let registry: TerminalSlotRegistry
  let selectedChanges: Array<{ worktreeTerminalKey: string; key: string | null }>
  let removedSessions: Array<{ key: string; repoRoot: string; branch: string; worktreePath: string }>

  beforeEach(() => {
    resetReposStore()
    selectedChanges = []
    removedSessions = []
    registry = new TerminalSlotRegistry(
      () => REPO_ROOT,
      (worktreeTerminalKey, key) => selectedChanges.push({ worktreeTerminalKey, key }),
      (key, base) =>
        removedSessions.push({
          key,
          repoRoot: base.repoRoot,
          branch: base.branch,
          worktreePath: base.worktreePath,
        }),
    )
    // Install into the singleton slot so any code that reaches the
    // registry via `getTerminalSlotRegistry()` (e.g., a Provider
    // mounted inside a sub-component) sees the same instance this
    // test constructed.
    setTerminalSlotRegistryForTests(registry)
  })

  afterEach(() => {
    // Drain pending state and clear listener maps on the per-test
    // instance, then release the singleton slot so the next test
    // starts clean. Mirrors the production singleton-vs-test
    // contract documented at `setTerminalSlotRegistryForTests`.
    registry.destroy()
    setTerminalSlotRegistryForTests(null)
    resetReposStore()
  })

  describe('event dispatch', () => {
    test('dispatches output to the correct session by ptySessionId index', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const worktreeSnapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      const key = worktreeSnapshot.slots[0]!.key
      const session = (registry as any).sessions.get(key)
      const handleOutputSpy = vi.spyOn(session, 'handleOutput')

      registry.handleOutput({ ptySessionId: 'pty_session_a_aaaaaaaaa', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)

      registry.handleOutput({ ptySessionId: 'pty_session_b_aaaaaaaaa', data: 'hello', seq: 1, processName: 'bash' })
      expect(handleOutputSpy).toHaveBeenCalledTimes(1)
    })

    test('dispatches title changes by ptySessionId index', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      const session = (registry as any).sessions.get(key)
      const handleServerTitleSpy = vi.spyOn(session, 'handleServerTitle')

      registry.handleServerTitle({ ptySessionId: 'pty_session_a_aaaaaaaaa', canonicalTitle: 'new title' })
      expect(handleServerTitleSpy).toHaveBeenCalledWith('new title')

      handleServerTitleSpy.mockClear()
      registry.handleServerTitle({ ptySessionId: 'pty_session_b_aaaaaaaaa', canonicalTitle: 'ignored' })
      expect(handleServerTitleSpy).not.toHaveBeenCalled()
    })

    test('dispatches exit by ptySessionId index', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      const session = (registry as any).sessions.get(key)
      const handleExitSpy = vi.spyOn(session, 'handleExit').mockReturnValue(true)

      registry.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      expect(handleExitSpy).toHaveBeenCalledTimes(1)

      handleExitSpy.mockClear()
      registry.handleExit({ ptySessionId: 'pty_session_b_aaaaaaaaa' })
      expect(handleExitSpy).not.toHaveBeenCalled()
    })

    test('handleExit invalidates the reattach snapshot cache for the exiting session', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      // Seed the reattach cache directly so we can assert the exit
      // event is what removes the entry, not the local-session
      // cleanup.
      ;(registry as any).reattachSnapshotCache.set(key, {
        ptySessionId: 'pty_session_a_aaaaaaaaa',
        snapshot: 'cached',
        snapshotSeq: 7,
      })
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(true)

      // Stub the local session's handleExit to return true so the
      // registry's existing discard path runs (the cache eviction
      // must not depend on it being absent, though).
      const session = (registry as any).sessions.get(key)
      vi.spyOn(session, 'handleExit').mockReturnValue(true)

      registry.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(false)
    })

    test('setReattachSnapshot evicts the oldest entry when the cache exceeds the safety cap', () => {
      // The cap is a safety net against bookkeeping drift (e.g. a
      // wedged server that never emits exit events). In normal use no
      // entry should be evicted, but if the cache somehow exceeds the
      // limit, the oldest entry is dropped.
      const limit = (TerminalSlotRegistry as unknown as { REATTACH_SNAPSHOT_CACHE_HARD_CAP: number })
        .REATTACH_SNAPSHOT_CACHE_HARD_CAP

      for (let i = 0; i < limit + 1; i++) {
        ;(registry as any).setReattachSnapshot(`key-${i}`, {
          ptySessionId: `session-${i}`,
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
      const cap = (TerminalSlotRegistry as unknown as { REATTACH_SNAPSHOT_CACHE_HARD_CAP: number })
        .REATTACH_SNAPSHOT_CACHE_HARD_CAP
      expect(cap).toBe(8)
    })

    test('handleExit preserves the reattach cache when the local session rejects the exit', () => {
      // Race scenario: the server emitted an exit for an old
      // ptySessionId, but the local session has already been updated to
      // a new ptySessionId (e.g., after a server-side restart). The
      // slotKeyByPtySessionId index may still map the old ptySessionId
      // to the local key. Evicting the reattach cache here would
      // discard a snapshot the user can still use on next reattach.
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      const session = (registry as any).sessions.get(key)
      // Local session is alive under a *different* ptySessionId.
      session.currentPtySessionId = () => 'pty_session_b_aaaaaaaaa'
      session.handleExit = vi.fn().mockReturnValue(false)

      // Seed the reattach cache for the old ptySessionId.
      ;(registry as any).reattachSnapshotCache.set(key, {
        ptySessionId: 'pty_session_a_aaaaaaaaa',
        snapshot: 'cached',
        snapshotSeq: 7,
      })
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(true)

      registry.handleExit({ ptySessionId: 'pty_session_a_aaaaaaaaa' })
      // Cache survives — the local session didn't confirm the exit.
      expect((registry as any).reattachSnapshotCache.has(key)).toBe(true)
    })
  })

  describe('notify granularity', () => {
    test('notifySession invalidates worktree cache', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_a_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const listener = vi.fn()
      const unsubscribe = registry.subscribeWorktree(WORKTREE_KEY, listener)

      // Prime the cache
      registry.worktreeSnapshot(WORKTREE_KEY)
      listener.mockClear()

      // Simulate metadata change via internal notifySession
      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      ;(registry as any).notifySession(key)

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
    })
  })

  describe('reconcileServerSlots', () => {
    test('creates missing local sessions and syncs selection', () => {
      registry.setRepoIndex(makeRepoIndex())

      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const snapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      expect(snapshot.count).toBe(1)
      expect(snapshot.slots[0]!.slotId).toBe('slot-1')
      expect(selectedChanges).toContainEqual({ worktreeTerminalKey: WORKTREE_KEY, key: snapshot.slots[0]!.key })
    })

    test('removes orphaned local sessions', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const keyBefore = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      expect(registry.isKnownSession(keyBefore)).toBe(true)

      registry.reconcileServerSlots(REPO_ROOT, [], 'client_local', new Map())

      expect(registry.isKnownSession(keyBefore)).toBe(false)
      expect(registry.worktreeSnapshot(WORKTREE_KEY).count).toBe(0)
      expect(removedSessions).toEqual([
        { key: keyBefore, repoRoot: REPO_ROOT, branch: BRANCH, worktreePath: WORKTREE_PATH },
      ])
    })

    test('session removal callback removes the owned workspace pane tab', async () => {
      const descriptor = makeDescriptor('slot-1', 1)
      seedRepoState({
        id: REPO_ROOT,
        branches: [createRepoBranch(BRANCH, { worktree: { path: WORKTREE_PATH } })],
        selectedBranch: BRANCH,
        workspacePaneTabOrderByBranch: {
          [BRANCH]: [
            workspacePaneStaticTabOrderEntry('status'),
            workspacePaneTerminalTabOrderEntry(descriptor.key),
            workspacePaneStaticTabOrderEntry('history'),
          ],
        },
      })
      const registryWithStore = new TerminalSlotRegistry(
        () => REPO_ROOT,
        () => {},
        (key, base) => {
          useReposStore.getState().removeWorkspacePaneTerminalTab(base.repoRoot, key, base.branch)
        },
      )
      try {
        registryWithStore.setRepoIndex(makeRepoIndex())
        registryWithStore.reconcileServerSlots(
          REPO_ROOT,
          [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
          'client_local',
          new Map(),
        )
        const session = (registryWithStore as any).sessions.get(descriptor.key)
        vi.spyOn(session, 'closeServerResourcesAndWait').mockResolvedValue(undefined)

        await registryWithStore.closeTerminalByDescriptor(descriptor.key, descriptor)

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
      const registryWithThrowingCallback = new TerminalSlotRegistry(
        () => REPO_ROOT,
        () => {},
        () => {
          throw new Error('store write failed')
        },
      )
      try {
        registryWithThrowingCallback.setRepoIndex(makeRepoIndex())
        registryWithThrowingCallback.reconcileServerSlots(
          REPO_ROOT,
          [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
          'client_local',
          new Map(),
        )
        const key = registryWithThrowingCallback.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
        const session = (registryWithThrowingCallback as any).sessions.get(key)
        const closeServerResourcesAndWait = vi.spyOn(session, 'closeServerResourcesAndWait').mockResolvedValue(undefined)
        const dispose = vi.spyOn(session, 'dispose').mockImplementation(() => {})

        await expect(
          registryWithThrowingCallback.closeTerminalByDescriptor(key, {
            repoRoot: REPO_ROOT,
            branch: BRANCH,
            worktreePath: WORKTREE_PATH,
          }),
        ).resolves.toBe(true)

        expect(closeServerResourcesAndWait).toHaveBeenCalled()
        expect(dispose).toHaveBeenCalledWith({ closeSlot: false })
        expect(registryWithThrowingCallback.isKnownSession(key)).toBe(false)
      } finally {
        registryWithThrowingCallback.destroy()
      }
    })

    test('closeTerminalByDescriptor resolves after server terminal resources close', async () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )
      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      const session = (registry as any).sessions.get(key)
      let resolveClose!: () => void
      vi.spyOn(session, 'closeServerResourcesAndWait').mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveClose = resolve
          }),
      )

      let settled = false
      const closePromise = registry
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

      expect(registry.isKnownSession(key)).toBe(true)
      expect(settled).toBe(false)

      resolveClose()
      await expect(closePromise).resolves.toBe(true)
      expect(settled).toBe(true)
      expect(registry.isKnownSession(key)).toBe(false)
    })

    test('closeTerminalByDescriptor keeps the session when server resource close fails', async () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )
      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      const session = (registry as any).sessions.get(key)
      vi.spyOn(session, 'closeServerResourcesAndWait').mockRejectedValue(new Error('close failed'))
      const dispose = vi.spyOn(session, 'dispose')

      await expect(
        registry.closeTerminalByDescriptor(key, {
          repoRoot: REPO_ROOT,
          branch: BRANCH,
          worktreePath: WORKTREE_PATH,
        }),
      ).resolves.toBe(false)

      expect(registry.isKnownSession(key)).toBe(true)
      expect(dispose).not.toHaveBeenCalled()
    })

    test('preserves current selection and falls back to controller when current is lost', () => {
      registry.setRepoIndex(makeRepoIndex())

      // First reconcile: slot-1 becomes current
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )
      expect(registry.worktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.slotId).toBe('slot-1')

      // Second reconcile: slot-1 removed, slot-2 is controller
      registry.reconcileServerSlots(
        REPO_ROOT,
        [
          makeServerSession('pty_session_2_aaaaaaaaa', 'slot-2', {
            controller: { clientId: 'client_local', status: 'connected' },
          }),
        ],
        'client_local',
        new Map(),
      )
      expect(registry.worktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.slotId).toBe('slot-2')
    })

    test('closing the active terminal selects the adjacent tab in display order', () => {
      registry.setRepoIndex(makeRepoIndex())

      registry.reconcileServerSlots(
        REPO_ROOT,
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1', { displayOrder: 1 }),
          makeServerSession('pty_session_2_aaaaaaaaa', 'slot-2', { displayOrder: 0 }),
          makeServerSession('pty_session_3_aaaaaaaaa', 'slot-3', { displayOrder: 2 }),
        ],
        'client_local',
        new Map(),
      )

      const snapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      const activeKey = snapshot.slots.find((session) => session.slotId === 'slot-2')?.key
      if (!activeKey) throw new Error('missing slot-2')

      registry.selectTerminal(WORKTREE_KEY, activeKey)
      ;(registry as any).removeSession(activeKey, { dispose: false, closeSlot: false })

      expect(registry.worktreeSnapshot(WORKTREE_KEY).selectedDescriptor?.slotId).toBe('slot-1')
    })

    test('invalidates cached worktree snapshot when server display order changes', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1', { displayOrder: 0 }),
          makeServerSession('pty_session_2_aaaaaaaaa', 'slot-2', { displayOrder: 1 }),
        ],
        'client_local',
        new Map(),
      )

      const firstSnapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      expect(firstSnapshot.slots.map((session) => session.slotId)).toEqual(['slot-1', 'slot-2'])

      registry.reconcileServerSlots(
        REPO_ROOT,
        [
          makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1', { displayOrder: 1 }),
          makeServerSession('pty_session_2_aaaaaaaaa', 'slot-2', { displayOrder: 0 }),
        ],
        'client_local',
        new Map(),
      )

      const secondSnapshot = registry.worktreeSnapshot(WORKTREE_KEY)
      expect(secondSnapshot.slots.map((session) => session.slotId)).toEqual(['slot-2', 'slot-1'])
    })
  })

  describe('snapshot cache', () => {
    test('returns cached snapshot without calling session.snapshot() repeatedly', () => {
      registry.setRepoIndex(makeRepoIndex())
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
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
      registry.reconcileServerSlots(
        REPO_ROOT,
        [makeServerSession('pty_session_1_aaaaaaaaa', 'slot-1')],
        'client_local',
        new Map(),
      )

      const key = registry.worktreeSnapshot(WORKTREE_KEY).slots[0]!.key
      const s1 = registry.snapshot(key)

      // metadata notify forces cache refresh
      ;(registry as any).notifySession(key, 'metadata')
      const s2 = registry.snapshot(key)
      expect(s1).not.toBe(s2)
    })
  })

  describe('singleton lifetime (P1.7)', () => {
    test('getTerminalSlotRegistry returns the same instance across calls with the same deps', () => {
      // The slot was filled by `beforeEach` with the per-test
      // `registry`. The getter must return that exact instance, not
      // construct a new one.
      const first = getTerminalSlotRegistry({
        getCurrentRepoId: () => REPO_ROOT,
        onSelectedWorktreeChange: () => {},
      })
      const second = getTerminalSlotRegistry({
        getCurrentRepoId: () => REPO_ROOT,
        onSelectedWorktreeChange: () => {},
      })
      expect(first).toBe(second)
      expect(first).toBe(registry)
    })

    test('setTerminalSlotRegistryForTests(null) clears the slot so the next getter constructs a fresh instance', () => {
      const original = registry
      setTerminalSlotRegistryForTests(null)
      const fresh = getTerminalSlotRegistry({
        getCurrentRepoId: () => REPO_ROOT,
        onSelectedWorktreeChange: () => {},
      })
      expect(fresh).not.toBe(original)
      // Re-install for `afterEach` cleanup.
      setTerminalSlotRegistryForTests(registry)
    })

    test('destroy clears the singleton slot when destroying the installed instance', () => {
      const original = getTerminalSlotRegistry({
        getCurrentRepoId: () => REPO_ROOT,
        onSelectedWorktreeChange: () => {},
      })
      expect(original).toBe(registry)

      original.destroy()

      const fresh = getTerminalSlotRegistry({
        getCurrentRepoId: () => REPO_ROOT,
        onSelectedWorktreeChange: () => {},
      })
      expect(fresh).not.toBe(original)
      fresh.destroy()
    })

    test('state added before a synthetic remount survives in the singleton slot', () => {
      // Simulates the production invariant: Provider remounts
      // (StrictMode, route round-trip) reuse the singleton, so any
      // state injected before the remount is still visible after.
      registry.setRepoIndex(makeRepoIndex())
      const descriptor = makeDescriptor('slot-1', 1)
      // Add a session via the internal API (no real WS, no
      // ManagedTerminalSlot — just the registry bookkeeping).
      ;(registry as any).sessions.set(descriptor.key, {
        descriptor,
        snapshot: () => ({ phase: 'open', message: null, processName: 'zsh', canonicalTitle: null }),
        currentPtySessionId: () => 'pty_session_1_aaaaaaaaa',
        dispose: () => {},
      })
      // Synthesize a remount: re-fetch the singleton via the
      // getter (the Provider's mount effect does exactly this).
      const after = getTerminalSlotRegistry({
        getCurrentRepoId: () => REPO_ROOT,
        onSelectedWorktreeChange: () => {},
      })
      expect(after).toBe(registry)
      // The session we injected is still in the registry's map —
      // i.e. the state survived the synthetic remount.
      const stored = (after as any).sessions.get(descriptor.key) as { descriptor: TerminalDescriptor } | undefined
      expect(stored?.descriptor.slotId).toBe('slot-1')
    })
  })
})
