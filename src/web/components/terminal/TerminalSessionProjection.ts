import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { createTerminalBellState } from '#/web/components/terminal/terminal-bell-state.ts'
import { createTerminalActivityState } from '#/web/components/terminal/terminal-activity-state.ts'
import { parseWorktreeKey, worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import type {
  TerminalSessionSnapshot,
  TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import {
  projectServerTerminalSession,
  type ReattachSnapshotCacheEntry,
} from '#/web/components/terminal/terminal-session-projection.ts'
import { userTerminalInput, type TerminalUserInputSource } from '#/web/components/terminal/terminal-input.ts'
import { terminalSessionDisplayOrder } from '#/web/components/terminal/terminal-session-display-order.ts'
import {
  captureTerminalHostGeometry,
  resolveTerminalStartupGeometryHint,
} from '#/web/components/terminal/terminal-session-geometry.ts'
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from '#/web/components/terminal/terminal-geometry.ts'
import {
  countOrphanedTerminalSessionKeys,
  resolveAdjacentTerminalSelectionAfterRemoval,
} from '#/web/components/terminal/terminal-session-eviction.ts'
import { syncTerminalPtySessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'
import { resolveSelectedTerminalKey } from '#/web/components/terminal/terminal-session-selection.ts'
import { buildWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-worktree-snapshot.ts'
import type {
  TerminalDescriptor,
  TerminalCreateOptions,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalRepoIndex,
  WorktreeTerminalSnapshot,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  canonicalTitle: null,
}
/**
 * Client-level authority for terminal session state.
 *
 * **Lifetime**: client-level singleton — one instance per client
 * process, created on first access via `getTerminalSessionProjection(...)`,
 * lives until the process tears down. The class is intentionally
 * Provider-independent: `TerminalSessionProvider` is just a wiring
 * adapter that forwards bridge events into the singleton and exposes
 * its API via React context. A dev-mode React StrictMode re-mount of
 * the Provider must NOT recreate the projection — see
 * `terminal-roadmap.md` P1.7.
 *
 * **Why singleton**: the terminal feature owns cross-cutting state
 * (parking root, per-worktree session lists, bell controller, startup geometry
 * cache, snapshot caches, pending create/close queues) that has no
 * natural React tree boundary. The previous Provider-owned lifetime
 * required a `pendingProjectionDestroyRef + setTimeout(0)` debounce to
 * survive StrictMode; the singleton removes that dance entirely.
 */
export class TerminalSessionProjection {
  private readonly onSelectedWorktreeChange: (worktreeTerminalKey: string, terminalKey: string | null) => void
  private readonly onTerminalSessionRemoved: (terminalKey: string, base: TerminalSessionBase) => void
  private readonly onTerminalSessionsMaterialized: (base: TerminalSessionBase, terminalKeys: readonly string[]) => void
  private repoIndex: TerminalRepoIndex = {}
  private parkingRoot: HTMLDivElement | null = null
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly terminalKeyByPtySessionId = new Map<string, string>()
  private readonly ptySessionIdByTerminalKey = new Map<string, string>()
  private readonly selectedTerminalKeyByWorktree = new Map<string, string>()
  private readonly preferredSelectedTerminalKeyByWorktree = new Map<string, string>()
  private readonly hostByWorktree = new Map<string, HTMLElement>()
  private readonly startupGeometryHintByWorktree = new Map<string, { cols: number; rows: number }>()
  private readonly pendingCreateByWorktree = new Map<
    string,
    {
      base: TerminalSessionBase
      options: TerminalCreateOptions
      promise: Promise<string>
      resolve: (terminalKey: string) => void
      reject: (error: unknown) => void
      flushing: boolean
      creating: boolean
    }
  >()
  // Durable close queue. `TerminalSession.dispose` used to fire
  // `terminalBridge.close({ ptySessionId })` as a `void ... .catch(() => {})`
  // — if the WebSocket was already closing (or `closeSocketIfIdle` raced
  // the request), the request was rejected before the server saw it and
  // the PTY stayed alive. The next `createTerminal` then reattached to
  // the orphan and printed the previous shell's `Restored session: …`
  // line a second time.
  //
  // Enqueue stores a promise, the background close settles it, and
  // `flushPendingCreate` awaits closes for the same worktree before
  // creating so the catalog cannot reattach to an orphan.
  // Failures are logged (the old path swallowed them silently) so any
  // future regression is visible in `terminalLog` rather than invisible
  // shell ghosts in the buffer.
  private readonly pendingCloseByPtySessionId = new Map<
    string,
    {
      worktreeTerminalKey: string
      promise: Promise<void>
      resolve: () => void
      reject: (error: unknown) => void
    }
  >()
  // User-initiated close hides the session from worktree snapshots
  // synchronously while server cleanup runs. This is terminal-runtime
  // visibility, not workspace pane selection state.
  private readonly hiddenClosingTerminalKeys = new Set<string>()
  private readonly closeCompletionByTerminalKey = new Map<string, Promise<boolean>>()
  private readonly snapshotCache = new Map<string, TerminalSnapshot>()
  // Safety-net hard cap. The expected cleanup is the server-exit
  // event (handleExit), with removeSession / destroy as secondary
  // sites; a small ceiling trims the oldest entries if bookkeeping
  // ever drifts (e.g. a wedged server that never emits exit). Set
  // well above the realistic number of simultaneously-detached
  // sessions, so in normal use no entry is evicted by the trim path.
  //
  // T2.1: lowered from 32 to 8. The 32 was sized for multi-tenant
  // assumptions; for a single user, typical detached-session count
  // is 1-3 with occasional 5. 8 gives generous headroom. Per-snapshot
  // size is bounded by the server's 16 MiB ring buffer (terminal-render-state.ts),
  // so worst-case reattach memory is 8 × 16 MiB = 128 MiB — almost
  // never realised because most snapshots are KB-scale. Eviction is
  // the source-of-truth fallback: a user who lost the snapshot sees
  // the server's ring buffer on next attach.
  private static readonly REATTACH_SNAPSHOT_CACHE_HARD_CAP = 8
  private readonly reattachSnapshotCache = new Map<string, ReattachSnapshotCacheEntry>()
  private readonly worktreeSnapshotCache = new Map<string, WorktreeTerminalSnapshot>()
  private readonly worktreeListeners = new Map<string, Set<() => void>>()
  private readonly repoBellCountListeners = new Map<string, Set<() => void>>()
  // Selector publication cache only. The unread bell source of truth
  // stays in `bellState`; this stores the last count delivered to
  // repo-level subscribers so unrelated worktree events do not wake
  // the repo picker.
  private readonly lastPublishedRepoBellCountByRepo = new Map<string, number>()
  private readonly snapshotListeners = new Map<string, Set<() => void>>()
  private readonly displayOrderByTerminalKey = new Map<string, number>()
  private readonly bellState = createTerminalBellState(
    (terminalKey) => {
      if (terminalKey) {
        const terminalWorktreeKey = this.sessions.get(terminalKey)?.descriptor.worktreeTerminalKey
        if (terminalWorktreeKey) this.notifyWorktree(terminalWorktreeKey)
        return
      }
      this.notifyAllWorktrees()
      this.notifyAllRepoBellCounts()
    },
    (count) => terminalBridge.setBadge(count),
  )
  private readonly activityState = createTerminalActivityState((worktreeTerminalKey) =>
    this.notifyWorktree(worktreeTerminalKey),
  )

  constructor(
    onSelectedWorktreeChange: (worktreeTerminalKey: string, terminalKey: string | null) => void = () => {},
    onTerminalSessionRemoved: (terminalKey: string, base: TerminalSessionBase) => void = () => {},
    onTerminalSessionsMaterialized: (base: TerminalSessionBase, terminalKeys: readonly string[]) => void = () => {},
  ) {
    this.onSelectedWorktreeChange = onSelectedWorktreeChange
    this.onTerminalSessionRemoved = onTerminalSessionRemoved
    this.onTerminalSessionsMaterialized = onTerminalSessionsMaterialized
  }

  setRepoIndex(repoIndex: TerminalRepoIndex): void {
    this.repoIndex = repoIndex
    this.pruneSessionsMissingFromRepoIndex()
    this.syncDescriptorsFromRepoIndex()
  }

  setParkingRoot(root: HTMLDivElement | null): void {
    this.parkingRoot = root
  }

  /**
   * Test-only / explicit-teardown path.
   *
   * Production code does NOT call this. The projection is a client-
   * level singleton and is meant to live for the client's entire
   * lifetime. The Provider never invokes `destroy()` on unmount; the
   * `pendingProjectionDestroyRef + setTimeout` debounce that used to
   * gate a Provider-unmount destroy has been removed.
   *
   * Tests use `destroy()` on a per-test local instance to drain
   * pending promises and clear listener maps before the test seam
   * (`setTerminalSessionProjectionForTests`) resets the singleton projection.
   *
   * Real production callers should only reach for this in narrowly
   * justified scenarios: a forced reset action in a dev menu, or a
   * `before-quit` handler that wants to reject in-flight creates/
   * closes. If you're tempted to call this from a Provider effect,
   * stop — the singleton already outlives that effect.
   */
  destroy(): void {
    setTerminalFocused(false)
    for (const pending of this.pendingCreateByWorktree.values()) {
      pending.reject(new Error('terminal session projection destroyed'))
    }
    for (const pending of this.pendingCloseByPtySessionId.values())
      pending.reject(new Error('terminal session projection destroyed'))
    for (const session of this.sessions.values()) session.dispose({ closeSession: false })
    this.sessions.clear()
    this.terminalKeyByPtySessionId.clear()
    this.ptySessionIdByTerminalKey.clear()
    this.selectedTerminalKeyByWorktree.clear()
    this.preferredSelectedTerminalKeyByWorktree.clear()
    this.hostByWorktree.clear()
    this.startupGeometryHintByWorktree.clear()
    this.pendingCreateByWorktree.clear()
    this.pendingCloseByPtySessionId.clear()
    this.hiddenClosingTerminalKeys.clear()
    this.closeCompletionByTerminalKey.clear()
    this.snapshotCache.clear()
    this.reattachSnapshotCache.clear()
    this.worktreeSnapshotCache.clear()
    this.worktreeListeners.clear()
    this.repoBellCountListeners.clear()
    this.lastPublishedRepoBellCountByRepo.clear()
    this.snapshotListeners.clear()
    this.bellState.reset()
    this.activityState.reset()
    if (projectionInstance === this) projectionInstance = null
  }

  handleOutput(event: { ptySessionId: string; data: string; seq: number; processName: string }): void {
    const directKey = this.terminalKeyByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directKey && directSession) {
      if (event.data.length > 0)
        this.activityState.markActivity(directKey, directSession.descriptor.worktreeTerminalKey)
      directSession.handleOutput(event)
    }
  }

  handleServerTitle(event: { ptySessionId: string; canonicalTitle: string | null }): void {
    const directKey = this.terminalKeyByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleServerTitle(event.canonicalTitle)
    }
  }

  handleExit(event: { ptySessionId: string }): void {
    const directKey = this.terminalKeyByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directKey && directSession?.handleExit(event)) {
      // Local runtime accepted the exit. Gating the discard on the
      // runtime's accept (rather than evicting eagerly on the
      // ptySessionId match) avoids discarding a still-valid cache entry
      // during a race where the local session has moved to a new
      // ptySessionId (e.g. after a server-side restart) but the index
      // still maps the old ptySessionId to the same terminalKey.
      // `discardLocalSessionAndDismissDetailIfLast → removeSession`
      // is what actually evicts the reattach cache entry for `directKey`.
      this.discardLocalSessionAndDismissDetailIfLast(directKey, directSession.descriptor)
      return
    }
    if (directKey && directSession && !directSession.currentPtySessionId()) {
      // The runtime is empty (exit was observed earlier, or the
      // session was never attached) but the ptySessionId index still
      // points at it. The cache entry is keyed by the local terminalKey, not
      // the old ptySessionId, so leaving it in place is the right call —
      // the next reattach may still hydrate from it.
      this.discardLocalSessionAndDismissDetailIfLast(directKey, directSession.descriptor)
    }
  }

  // Targeted drop on a server-side `session-closed` broadcast. Mirrors
  // `handleExit` but for the close path: the originating window has
  // already disposed the local entry, so the no-op case is the
  // common one. Sibling windows with a stale local entry get
  // consistent state within one network roundtrip instead of waiting
  // for the broader `sessions-changed` list-rescan. We route through
  // `discardLocalSessionAndDismissDetailIfLast` (rather than
  // `closeTerminal`) because the server has already killed the PTY
  // — calling `close` again would no-op the `closeSessionForUser` check
  // on the server and add a useless WS roundtrip.
  handleSessionClosed(ptySessionId: string): void {
    const directKey = this.terminalKeyByPtySessionId.get(ptySessionId)
    if (!directKey) return
    const session = this.sessions.get(directKey)
    if (!session) return
    this.discardLocalSessionAndDismissDetailIfLast(directKey, session.descriptor)
  }

  handleIdentity(event: TerminalIdentityViewModel): void {
    const directKey = this.terminalKeyByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleIdentity(event)
    }
  }

  handleLifecycle(event: TerminalLifecycleViewModel): void {
    const directKey = this.terminalKeyByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleLifecycle(event)
    }
  }

  reconcileServerSessions(
    repoRoot: string,
    serverSessions: ServerTerminalSessionSummary[],
    clientId: string,
    snapshotsByPtySessionId: ReadonlyMap<string, TerminalSessionSnapshot>,
  ): void {
    if (!this.repoIndex[repoRoot]) return

    const { controllerKeyByWorktree, touchedWorktrees, displayOrderChangedWorktrees } = this.materializeServerSessions(
      repoRoot,
      serverSessions,
      clientId,
      snapshotsByPtySessionId,
    )

    const serverKeys = new Set(serverSessions.map((s) => s.terminalKey))
    this.evictOrphanedLocalSessions(repoRoot, serverKeys)

    this.resolveSelectedKeysForTouchedWorktrees(touchedWorktrees, controllerKeyByWorktree)
    this.publishMaterializedTerminalTabs(touchedWorktrees)
    for (const worktreeTerminalKey of displayOrderChangedWorktrees) {
      this.notifyWorktree(worktreeTerminalKey)
    }
  }

  // Phase 1: for each server session, ensure a local TerminalSession
  // exists, hydrate it with the latest server-side metadata, and track
  // which worktrees saw any change. Side effects: ensureSession,
  // session.hydrate, displayOrderByTerminalKey, syncPtySessionIdIndex.
  private materializeServerSessions(
    repoRoot: string,
    serverSessions: ServerTerminalSessionSummary[],
    clientId: string,
    snapshotsByPtySessionId: ReadonlyMap<string, TerminalSessionSnapshot>,
  ): {
    controllerKeyByWorktree: Map<string, string>
    touchedWorktrees: Set<string>
    displayOrderChangedWorktrees: Set<string>
  } {
    const controllerKeyByWorktree = new Map<string, string>()
    const touchedWorktrees = new Set<string>()
    const displayOrderChangedWorktrees = new Set<string>()

    for (const serverSession of serverSessions) {
      const projected = projectServerTerminalSession({
        repoIndex: this.repoIndex,
        repoRoot,
        serverSession,
        clientId,
        serverSnapshot: snapshotsByPtySessionId.get(serverSession.ptySessionId) ?? null,
        reattachSnapshot: this.reattachSnapshotCache.get(serverSession.terminalKey) ?? null,
      })
      if (!projected) continue
      touchedWorktrees.add(projected.worktreeTerminalKey)
      const { descriptor } = projected
      if (!this.sessions.has(descriptor.terminalKey)) this.ensureSession(descriptor)
      this.sessions.get(descriptor.terminalKey)?.hydrate(projected.hydrateInput)
      this.syncPtySessionIdIndex(descriptor.terminalKey, projected.hydrateInput.ptySessionId)
      if (projected.controlsTerminal) controllerKeyByWorktree.set(projected.worktreeTerminalKey, descriptor.terminalKey)
      const previousDisplayOrder = this.displayOrderByTerminalKey.get(descriptor.terminalKey)
      this.displayOrderByTerminalKey.set(descriptor.terminalKey, projected.displayOrder)
      if (previousDisplayOrder !== undefined && previousDisplayOrder !== projected.displayOrder) {
        displayOrderChangedWorktrees.add(projected.worktreeTerminalKey)
      }
    }

    return { controllerKeyByWorktree, touchedWorktrees, displayOrderChangedWorktrees }
  }

  // Phase 2: drop local sessions that have a serverId but no longer
  // appear on the server. Only sessions that have ever been attached
  // (i.e. have a ptySessionId in our index) are eligible for eviction;
  // never-attached local shells (purely UI placeholders) are left
  // alone. Returns the count for the debug log.
  private evictOrphanedLocalSessions(repoRoot: string, serverKeys: Set<string>): number {
    const orphanedKeys = countOrphanedTerminalSessionKeys({
      repoRoot,
      localSessionKeys: Array.from(this.sessions.keys()),
      getRepoRootForKey: (terminalKey) => this.sessions.get(terminalKey)?.descriptor.repoRoot ?? null,
      hasServerPtySessionId: (terminalKey) => this.ptySessionIdByTerminalKey.has(terminalKey),
      serverKeys,
    })
    for (const terminalKey of orphanedKeys) {
      const session = this.sessions.get(terminalKey)
      if (!session) continue
      this.discardLocalSessionAndDismissDetailIfLast(terminalKey, session.descriptor)
    }
    return orphanedKeys.length
  }

  // Phase 3: for every worktree that saw a server-side change, decide
  // which local terminal should be selected. The selection prefers the
  // controller of the worktree, then the user's last selection, then
  // the first available terminal.
  private resolveSelectedKeysForTouchedWorktrees(
    touchedWorktrees: Set<string>,
    controllerKeyByWorktree: Map<string, string>,
  ): void {
    for (const worktreeKey of touchedWorktrees) {
      const current = this.selectedTerminalKeyByWorktree.get(worktreeKey) ?? null
      const preferred = this.preferredSelectedTerminalKeyByWorktree.get(worktreeKey) ?? null
      const next = resolveSelectedTerminalKey({
        worktreeTerminalKey: worktreeKey,
        preferredTerminalKey: preferred,
        currentTerminalKey: current,
        controllerTerminalKey: controllerKeyByWorktree.get(worktreeKey) ?? null,
        sortedDescriptors: this.visibleSessionsForWorktree(worktreeKey).map((session) => session.descriptor),
        isSelectedTerminalKeyValid: (candidateWorktreeKey, terminalKey) =>
          this.isSelectedTerminalKeyValid(candidateWorktreeKey, terminalKey),
      })
      this.selectTerminalKey(worktreeKey, next)
    }
  }

  private publishMaterializedTerminalTabs(touchedWorktrees: Set<string>): void {
    for (const worktreeTerminalKey of touchedWorktrees) {
      const descriptors = this.visibleSessionsForWorktree(worktreeTerminalKey).map((session) => session.descriptor)
      const firstDescriptor = descriptors[0]
      if (!firstDescriptor) continue
      try {
        this.onTerminalSessionsMaterialized(
          {
            repoRoot: firstDescriptor.repoRoot,
            branch: firstDescriptor.branch,
            worktreePath: firstDescriptor.worktreePath,
          },
          descriptors.map((descriptor) => descriptor.terminalKey),
        )
      } catch (err) {
        terminalSessionProviderLog.warn('terminal materialize callback failed', { worktreeTerminalKey, err })
      }
    }
  }

  createTerminal = (base: TerminalSessionBase, options: TerminalCreateOptions = {}): Promise<string> =>
    this.enqueuePendingCreate(base, worktreeTerminalKey(base.repoRoot, base.worktreePath), options)

  registerHost = (worktreeTerminalKey: string, host: HTMLElement): void => {
    this.hostByWorktree.set(worktreeTerminalKey, host)
    captureTerminalHostGeometry({
      worktreeTerminalKey,
      hostByWorktree: this.hostByWorktree,
      startupGeometryHintByWorktree: this.startupGeometryHintByWorktree,
    })
  }

  unregisterHost = (worktreeTerminalKey: string, host: HTMLElement): void => {
    if (this.hostByWorktree.get(worktreeTerminalKey) !== host) return
    this.hostByWorktree.delete(worktreeTerminalKey)
  }

  private async performCreateTerminal(
    base: TerminalSessionBase,
    geometry: { cols: number; rows: number },
    options: TerminalCreateOptions,
  ): Promise<string> {
    const clientId = readOrCreateWebTerminalClientId()
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    const createKind = options.startupShellCommand
      ? 'additional'
      : this.visibleSessionsForWorktree(terminalWorktreeKey).length === 0
        ? 'primary'
        : 'additional'
    const result = await terminalBridge.create({
      repoRoot: base.repoRoot,
      branch: base.branch,
      worktreePath: base.worktreePath,
      kind: createKind,
      ...(options.startupShellCommand ? { startupShellCommand: options.startupShellCommand } : {}),
      cols: geometry.cols,
      rows: geometry.rows,
      clientId,
    })
    if (!result.ok) {
      throw new Error(result.message)
    }
    const snapshotPtySessionId = result.ptySessionId
    if (!snapshotPtySessionId || typeof result.snapshot !== 'string' || typeof result.snapshotSeq !== 'number') {
      throw new Error('error.terminal-create-failed')
    }
    // First-frame contract: when the server reports `action: 'created'`,
    // the catalog must echo that session in `sessions[]`. The first-frame
    // payload is the source of truth — fabricates below this point would
    // hide a real protocol mismatch (e.g., a half-applied create that
    // committed the session row but skipped the catalog append). Reject
    // and let the operator restart the create.
    const createdSession = result.sessions.find(
      (session) => session.terminalKey === result.terminalKey && session.ptySessionId === snapshotPtySessionId,
    )
    if (!createdSession) {
      throw new Error('error.terminal-create-failed')
    }
    const serverSessions = result.sessions
    this.setPreferredSelectedTerminalKey(terminalWorktreeKey, result.terminalKey)
    this.reconcileServerSessions(
      base.repoRoot,
      serverSessions,
      clientId,
      new Map<string, TerminalSessionSnapshot>([[snapshotPtySessionId, result as TerminalSessionSnapshot]]),
    )
    return result.terminalKey
  }

  private startupGeometryHint(worktreeTerminalKey: string): { cols: number; rows: number } {
    return (
      resolveTerminalStartupGeometryHint({
        worktreeTerminalKey,
        hostByWorktree: this.hostByWorktree,
        startupGeometryHintByWorktree: this.startupGeometryHintByWorktree,
        selectedDescriptor: this.selectedDescriptor(worktreeTerminalKey),
        getAttachmentSnapshot: (terminalKey) => this.snapshot(terminalKey).attachment,
      }) ?? { cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS }
    )
  }

  private enqueuePendingCreate(
    base: TerminalSessionBase,
    worktreeTerminalKey: string,
    options: TerminalCreateOptions,
  ): Promise<string> {
    const existing = this.pendingCreateByWorktree.get(worktreeTerminalKey)
    if (existing) {
      if (existing.options.startupShellCommand === options.startupShellCommand) return existing.promise
      return existing.promise
        .catch(() => undefined)
        .then(() => this.enqueuePendingCreate(base, worktreeTerminalKey, options))
    }
    let resolve!: (terminalKey: string) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    this.pendingCreateByWorktree.set(worktreeTerminalKey, {
      base,
      options,
      promise,
      resolve,
      reject,
      flushing: false,
      creating: false,
    })
    this.notifyWorktree(worktreeTerminalKey)
    void this.flushPendingCreate(worktreeTerminalKey)
    return promise
  }

  private async flushPendingCreate(worktreeTerminalKey: string): Promise<void> {
    const pending = this.pendingCreateByWorktree.get(worktreeTerminalKey)
    if (!pending || pending.flushing) return
    // Synchronous claim: enqueuePendingCreate, registerHost, and a
    // StrictMode double-invoke can all arrive here while a prior flush
    // is still awaiting. The first one through sets the flag; the rest
    // bail and observe the same pending promise.
    pending.flushing = true
    try {
      // Close-drain lives here (not at the top of `createTerminal`) so
      // `enqueuePendingCreate` puts the entry into the map first and
      // emits the synchronous `pendingCreate: true` snapshot.
      await this.flushPendingClosesForWorktree(worktreeTerminalKey)
      if (this.pendingCreateByWorktree.get(worktreeTerminalKey) !== pending) {
        throw new Error('terminal create request canceled')
      }
      const geometry = this.startupGeometryHint(worktreeTerminalKey)
      if (this.pendingCreateByWorktree.get(worktreeTerminalKey) !== pending) {
        throw new Error('terminal create request canceled')
      }
      pending.creating = true
      pending.resolve(await this.performCreateTerminal(pending.base, geometry, pending.options))
    } catch (error) {
      pending.reject(error)
    } finally {
      pending.creating = false
      if (this.pendingCreateByWorktree.get(worktreeTerminalKey) === pending) {
        this.pendingCreateByWorktree.delete(worktreeTerminalKey)
        this.notifyWorktree(worktreeTerminalKey)
      }
    }
  }

  // --- Durable close --------------------------------------------------------

  // Queue a close against the server. Returns immediately with a
  // promise the caller can ignore; the close fires in the background
  // and the entry is removed when it settles (resolve or reject).
  //
  // Returning a stable promise (deduped per ptySessionId) is intentional:
  // a `restart` and a `dispose` can both call this for the same
  // ptySessionId in quick succession. The first call owns the request;
  // the second is a no-op and just observes the same outcome.
  enqueueDurableClose(input: { ptySessionId: string; worktreeTerminalKey: string }): Promise<void> {
    const existing = this.pendingCloseByPtySessionId.get(input.ptySessionId)
    if (existing) return existing.promise

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    this.pendingCloseByPtySessionId.set(input.ptySessionId, {
      worktreeTerminalKey: input.worktreeTerminalKey,
      promise,
      resolve,
      reject,
    })

    void this.performDurableClose(input.ptySessionId)
    return promise
  }

  // Awaited at the top of `createTerminal` for the same worktree.
  // Drains every in-flight close targeting `worktreeTerminalKey` so
  // the catalog sees a clean slate. Failures are swallowed at this
  // seam: the user is about to create, and a stuck close should not
  // block them — the failure is already logged inside
  // `performDurableClose` and the user can `pruneTerminals` from the
  // UI to recover if the orphan ever resurfaces.
  private async flushPendingClosesForWorktree(worktreeTerminalKey: string): Promise<void> {
    if (this.pendingCloseByPtySessionId.size === 0) return
    const pendingForWorktree = Array.from(this.pendingCloseByPtySessionId.entries()).filter(
      ([, entry]) => entry.worktreeTerminalKey === worktreeTerminalKey,
    )
    if (pendingForWorktree.length === 0) return
    await Promise.allSettled(pendingForWorktree.map(([, entry]) => entry.promise))
  }

  private async performDurableClose(ptySessionId: string): Promise<void> {
    try {
      await terminalBridge.close({ ptySessionId })
      const entry = this.pendingCloseByPtySessionId.get(ptySessionId)
      this.pendingCloseByPtySessionId.delete(ptySessionId)
      entry?.resolve()
    } catch (err) {
      const entry = this.pendingCloseByPtySessionId.get(ptySessionId)
      this.pendingCloseByPtySessionId.delete(ptySessionId)
      // The old fire-and-forget path swallowed this rejection. Loud
      // logging is intentional: the failure mode (orphan PTY surviving
      // a tab close) is otherwise invisible to operators and surfaces
      // only as a confused user re-opening a tab and seeing the prior
      // shell's `Restored session: …` line print twice.
      terminalSessionProviderLog.warn('durable close failed for terminal session', { ptySessionId, err })
      entry?.reject(err)
    }
  }

  private async settlePendingCreateForWorktree(worktreeTerminalKey: string): Promise<void> {
    const pending = this.pendingCreateByWorktree.get(worktreeTerminalKey)
    if (!pending) return
    if (!pending.creating) {
      const error = new Error('terminal create request canceled')
      if (this.pendingCreateByWorktree.get(worktreeTerminalKey) === pending) {
        this.pendingCreateByWorktree.delete(worktreeTerminalKey)
        pending.reject(error)
        this.notifyWorktree(worktreeTerminalKey)
      }
    }
    try {
      await pending.promise
    } catch {
      // A rejected create means no terminal session was created for this
      // pending request. The release barrier can continue to close any
      // sessions that were already present or that did get materialized.
    }
  }

  private async waitForPendingClosesForWorktree(worktreeTerminalKey: string): Promise<boolean> {
    const pendingForWorktree = Array.from(this.pendingCloseByPtySessionId.values()).filter(
      (entry) => entry.worktreeTerminalKey === worktreeTerminalKey,
    )
    if (pendingForWorktree.length === 0) return true
    const results = await Promise.allSettled(pendingForWorktree.map((entry) => entry.promise))
    return results.every((result) => result.status === 'fulfilled')
  }

  private selectedDescriptor(worktreeTerminalKey: string): TerminalDescriptor | null {
    const selectedKey = this.selectedTerminalKeyByWorktree.get(worktreeTerminalKey)
    if (selectedKey && this.hiddenClosingTerminalKeys.has(selectedKey)) return null
    return selectedKey ? (this.sessions.get(selectedKey)?.descriptor ?? null) : null
  }

  setPreferredSelectedTerminalKeys(selectedKeysByWorktree: Record<string, string>): void {
    const nextPreferred = new Map(Object.entries(selectedKeysByWorktree))
    const worktrees = new Set<string>([
      ...Array.from(this.preferredSelectedTerminalKeyByWorktree.keys()),
      ...Array.from(nextPreferred.keys()),
      ...Array.from(this.selectedTerminalKeyByWorktree.keys()),
    ])
    this.preferredSelectedTerminalKeyByWorktree.clear()
    for (const [worktreeTerminalKey, terminalKey] of nextPreferred)
      this.preferredSelectedTerminalKeyByWorktree.set(worktreeTerminalKey, terminalKey)
    for (const worktreeTerminalKey of worktrees) {
      const preferred = this.preferredSelectedTerminalKeyByWorktree.get(worktreeTerminalKey) ?? null
      if (!preferred || !this.isSelectedTerminalKeyValid(worktreeTerminalKey, preferred)) continue
      this.selectTerminalKey(worktreeTerminalKey, preferred)
    }
  }

  worktreeSnapshot = (worktreeTerminalKey: string): WorktreeTerminalSnapshot => {
    const cached = this.worktreeSnapshotCache.get(worktreeTerminalKey)
    if (cached) return cached
    const snapshot = buildWorktreeTerminalSnapshot({
      worktreeTerminalKey,
      selectedDescriptor: this.selectedDescriptor(worktreeTerminalKey),
      pendingCreate: this.pendingCreateByWorktree.has(worktreeTerminalKey),
      sessions: this.visibleSessionsForWorktree(worktreeTerminalKey),
      selectedTerminalKey: this.selectedTerminalKeyByWorktree.get(worktreeTerminalKey) ?? null,
      getCachedSnapshot: (terminalKey) => this.snapshotCache.get(terminalKey) ?? null,
      cacheSnapshot: (terminalKey, nextSnapshot) => this.snapshotCache.set(terminalKey, nextSnapshot),
      hasBell: (terminalKey) => this.bellState.hasBell(terminalKey),
      hasRecentActivity: (terminalKey) => this.activityState.hasRecentActivity(terminalKey),
      getDisplayOrder: (session) => terminalSessionDisplayOrder(session.descriptor, this.displayOrderByTerminalKey),
    })
    this.worktreeSnapshotCache.set(worktreeTerminalKey, snapshot)
    return snapshot
  }

  subscribeWorktree = (worktreeTerminalKey: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.worktreeListeners, worktreeTerminalKey, listener)
  }

  repoBellCount = (repoRoot: string): number => {
    let count = 0
    for (const session of this.sessions.values()) {
      const terminalKey = session.descriptor.terminalKey
      if (
        session.descriptor.repoRoot === repoRoot &&
        !this.hiddenClosingTerminalKeys.has(terminalKey) &&
        this.bellState.hasBell(terminalKey)
      )
        count++
    }
    return count
  }

  subscribeRepoBellCount = (repoRoot: string, listener: () => void): (() => void) => {
    if (!this.repoBellCountListeners.has(repoRoot))
      this.lastPublishedRepoBellCountByRepo.set(repoRoot, this.repoBellCount(repoRoot))
    const unsubscribe = this.subscribeToKeyedListeners(this.repoBellCountListeners, repoRoot, listener)
    return () => {
      unsubscribe()
      if (!this.repoBellCountListeners.has(repoRoot)) this.lastPublishedRepoBellCountByRepo.delete(repoRoot)
    }
  }

  selectTerminal = (worktreeTerminalKey: string, terminalKey: string): void => {
    const session = this.sessions.get(terminalKey)
    if (
      !session ||
      this.hiddenClosingTerminalKeys.has(terminalKey) ||
      session.descriptor.worktreeTerminalKey !== worktreeTerminalKey
    )
      return
    const wasSelected = this.selectedTerminalKeyByWorktree.get(worktreeTerminalKey) === terminalKey
    const hadBell = this.bellState.hasBell(terminalKey)
    if (wasSelected && !hadBell) return
    this.selectTerminalKey(worktreeTerminalKey, terminalKey, { notify: !hadBell })
    this.bellState.clear(terminalKey)
  }

  clearBell = (terminalKey: string): boolean => {
    return this.bellState.clear(terminalKey)
  }

  scrollToBottom = (terminalKey: string): void => {
    this.sessions.get(terminalKey)?.scrollToBottom()
  }

  scrollLines = (terminalKey: string, amount: number): void => {
    this.sessions.get(terminalKey)?.scrollLines(amount)
  }

  closeTerminalByDescriptor = async (terminalKey: string, base: TerminalSessionBase): Promise<boolean> => {
    const session = this.sessions.get(terminalKey)
    if (!session || session.descriptor.worktreeTerminalKey !== worktreeTerminalKey(base.repoRoot, base.worktreePath))
      return false
    return await this.closeTerminal(terminalKey)
  }

  closeTerminalsForWorktree = async (base: TerminalSessionBase): Promise<boolean> => {
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    await this.settlePendingCreateForWorktree(terminalWorktreeKey)
    const terminalKeys = this.sortedSessionsForWorktree(terminalWorktreeKey).map(
      (session) => session.descriptor.terminalKey,
    )
    // When no terminal sessions exist there is nothing to release. Skip the
    // durable-close wait so a stale pending close (e.g. from an earlier tab
    // that already left the worktree) cannot block worktree removal.
    if (terminalKeys.length === 0) return true
    const results = await Promise.all(terminalKeys.map((terminalKey) => this.closeTerminal(terminalKey)))
    const pendingClosesSettled = await this.waitForPendingClosesForWorktree(terminalWorktreeKey)
    return results.every(Boolean) && pendingClosesSettled
  }

  attach = (descriptor: TerminalDescriptor, host: HTMLElement): void => {
    this.ensureSession(descriptor).attach(host)
  }

  detach = (terminalKey: string, host: HTMLElement): void => {
    const session = this.sessions.get(terminalKey)
    if (session && this.parkingRoot) {
      const serialized = session.serialize()
      const ptySessionId = session.currentPtySessionId()
      if (serialized && ptySessionId) {
        this.setReattachSnapshot(terminalKey, { ptySessionId, snapshot: serialized, snapshotSeq: 0 })
      }
      session.detach(host, this.parkingRoot)
    }
  }

  restart = (terminalKey: string): void => {
    this.sessions.get(terminalKey)?.restart()
  }

  focusTerminal = (terminalKey: string): void => {
    this.sessions.get(terminalKey)?.focus()
  }

  snapshot = (terminalKey: string): TerminalSnapshot => {
    const cached = this.snapshotCache.get(terminalKey)
    if (cached) return cached
    const session = this.sessions.get(terminalKey)
    if (!session) return EMPTY_TERMINAL_SNAPSHOT
    const next = session.snapshot()
    this.snapshotCache.set(terminalKey, next)
    return next
  }

  isKnownSession = (terminalKey: string): boolean => {
    return this.sessions.has(terminalKey)
  }

  subscribeSnapshot = (terminalKey: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.snapshotListeners, terminalKey, listener)
  }

  isTerminalFocusTarget = (terminalKey: string, target: EventTarget | null): boolean => {
    return this.sessions.get(terminalKey)?.isTerminalFocusTarget(target) ?? false
  }

  findNext = (terminalKey: string, term: string, incremental?: boolean) => {
    return (
      this.sessions.get(terminalKey)?.findNext(term, incremental) ?? { resultIndex: -1, resultCount: 0, found: false }
    )
  }

  findPrevious = (terminalKey: string, term: string) => {
    return this.sessions.get(terminalKey)?.findPrevious(term) ?? { resultIndex: -1, resultCount: 0, found: false }
  }

  clearSearch = (terminalKey: string): void => {
    this.sessions.get(terminalKey)?.clearSearch()
  }

  writeInput = (terminalKey: string, data: string, source: TerminalUserInputSource = 'command'): void => {
    this.sessions.get(terminalKey)?.writeInput(userTerminalInput(data, source))
  }

  takeover = (terminalKey: string): Promise<boolean> => {
    const session = this.sessions.get(terminalKey)
    if (!session) return Promise.resolve(false)
    return session.takeover()
  }

  serialize = (terminalKey: string): string => {
    return this.sessions.get(terminalKey)?.serialize() ?? ''
  }

  private notifyWorktree(worktreeTerminalKey: string): void {
    this.worktreeSnapshotCache.delete(worktreeTerminalKey)
    const listeners = this.worktreeListeners.get(worktreeTerminalKey)
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (err) {
          terminalSessionProviderLog.warn('worktree listener threw', { worktreeTerminalKey, err })
        }
      }
    }
    const repoRoot = parseWorktreeKey(worktreeTerminalKey)?.repoRoot
    if (repoRoot) this.notifyRepoBellCountIfChanged(repoRoot)
  }

  private notifySnapshot(terminalKey: string): void {
    const listeners = this.snapshotListeners.get(terminalKey)
    if (!listeners) return
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch (err) {
        terminalSessionProviderLog.warn('snapshot listener threw', { terminalKey, err })
      }
    }
  }

  private notifyAllWorktrees(): void {
    for (const worktreeTerminalKey of Array.from(this.worktreeListeners.keys()))
      this.notifyWorktree(worktreeTerminalKey)
  }

  private notifyRepoBellCountIfChanged(repoRoot: string): void {
    if (!this.repoBellCountListeners.has(repoRoot)) return
    const previous = this.lastPublishedRepoBellCountByRepo.get(repoRoot) ?? 0
    const next = this.repoBellCount(repoRoot)
    if (previous === next) return
    this.lastPublishedRepoBellCountByRepo.set(repoRoot, next)
    this.notifyRepoBellCount(repoRoot)
  }

  private notifyRepoBellCount(repoRoot: string): void {
    const listeners = this.repoBellCountListeners.get(repoRoot)
    if (!listeners) return
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch (err) {
        terminalSessionProviderLog.warn('repo bell count listener threw', { repoRoot, err })
      }
    }
  }

  private notifyAllRepoBellCounts(): void {
    for (const repoRoot of Array.from(this.repoBellCountListeners.keys())) this.notifyRepoBellCountIfChanged(repoRoot)
  }

  private subscribeToKeyedListeners(
    listenersMap: Map<string, Set<() => void>>,
    listenerKey: string,
    listener: () => void,
  ): () => void {
    let listeners = listenersMap.get(listenerKey)
    if (!listeners) {
      listeners = new Set()
      listenersMap.set(listenerKey, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = listenersMap.get(listenerKey)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listenersMap.delete(listenerKey)
    }
  }

  private syncPtySessionIdIndex(terminalKey: string, ptySessionId: string | null): void {
    syncTerminalPtySessionIdIndex({
      terminalKey,
      ptySessionId,
      ptySessionIdByTerminalKey: this.ptySessionIdByTerminalKey,
      terminalKeyByPtySessionId: this.terminalKeyByPtySessionId,
    })
  }

  private notifySession(terminalKey: string): void {
    const session = this.sessions.get(terminalKey)
    this.syncPtySessionIdIndex(terminalKey, session?.currentPtySessionId() ?? null)
    if (session) {
      this.snapshotCache.set(terminalKey, session.snapshot())
    } else {
      this.snapshotCache.delete(terminalKey)
    }
    this.notifySnapshot(terminalKey)
    const worktreeTerminalKey = session?.descriptor.worktreeTerminalKey
    if (worktreeTerminalKey) this.notifyWorktree(worktreeTerminalKey)
  }

  // Cache write for the reattach path. The expected cleanup is the
  // server-exit event (handleExit), with removeSession / destroy as
  // secondary sites. A small hard cap trims the oldest entries if
  // bookkeeping ever drifts (e.g., a wedged server that never emits
  // exit); the limit is set well above the realistic number of
  // simultaneously-detached sessions.
  private setReattachSnapshot(terminalKey: string, entry: ReattachSnapshotCacheEntry): void {
    if (this.reattachSnapshotCache.has(terminalKey)) this.reattachSnapshotCache.delete(terminalKey)
    this.reattachSnapshotCache.set(terminalKey, entry)
    while (this.reattachSnapshotCache.size > TerminalSessionProjection.REATTACH_SNAPSHOT_CACHE_HARD_CAP) {
      const oldestTerminalKey = this.reattachSnapshotCache.keys().next().value
      if (oldestTerminalKey === undefined) break
      this.reattachSnapshotCache.delete(oldestTerminalKey)
    }
  }

  private removeSession(terminalKey: string, options: { dispose: boolean; closeSession?: boolean }): boolean {
    const session = this.sessions.get(terminalKey)
    if (!session) return false
    const worktreeTerminalKey = session.descriptor.worktreeTerminalKey
    const orderedTerminalKeysBeforeRemoval = this.visibleSessionsForWorktree(worktreeTerminalKey).map(
      (item) => item.descriptor.terminalKey,
    )
    const wasSelected = this.selectedTerminalKeyByWorktree.get(worktreeTerminalKey) === terminalKey
    this.hiddenClosingTerminalKeys.delete(terminalKey)
    this.closeCompletionByTerminalKey.delete(terminalKey)
    this.syncPtySessionIdIndex(terminalKey, null)
    this.sessions.delete(terminalKey)
    this.snapshotCache.delete(terminalKey)
    this.reattachSnapshotCache.delete(terminalKey)
    this.displayOrderByTerminalKey.delete(terminalKey)
    this.activityState.remove(terminalKey)
    this.notifyTerminalSessionRemoved(terminalKey, session.descriptor)
    this.notifySnapshot(terminalKey)
    this.bellState.remove(terminalKey)
    if (options.dispose) session.dispose({ closeSession: options.closeSession !== false })
    if (wasSelected) {
      const nextTerminalKey = resolveAdjacentTerminalSelectionAfterRemoval(
        orderedTerminalKeysBeforeRemoval,
        terminalKey,
      )
      this.selectTerminalKey(worktreeTerminalKey, nextTerminalKey, { notify: false })
    }
    this.notifyWorktree(worktreeTerminalKey)
    return true
  }

  private notifyTerminalSessionRemoved(terminalKey: string, base: TerminalSessionBase): void {
    try {
      this.onTerminalSessionRemoved(terminalKey, base)
    } catch (err) {
      terminalSessionProviderLog.warn('terminal session removal callback failed', { terminalKey, err })
    }
  }

  private async closeTerminal(terminalKey: string): Promise<boolean> {
    const pending = this.closeCompletionByTerminalKey.get(terminalKey)
    if (pending) return pending
    const session = this.sessions.get(terminalKey)
    if (!session) return false
    const promise = this.runClose(terminalKey, session)
    this.closeCompletionByTerminalKey.set(terminalKey, promise)
    const cleanup = () => {
      if (this.closeCompletionByTerminalKey.get(terminalKey) === promise)
        this.closeCompletionByTerminalKey.delete(terminalKey)
    }
    void promise.then(cleanup, cleanup)
    return promise
  }

  private async runClose(terminalKey: string, session: TerminalSession): Promise<boolean> {
    this.hideClosingSession(terminalKey, session)
    try {
      await session.closeServerResourcesAndWait()
    } catch (err) {
      terminalSessionProviderLog.warn('terminal close failed', { terminalKey, err })
      this.restoreClosingSession(terminalKey, session)
      return false
    }
    if (this.sessions.get(terminalKey) !== session) return true
    return this.removeSession(terminalKey, { dispose: true, closeSession: false })
  }

  private hideClosingSession(terminalKey: string, session: TerminalSession): void {
    if (this.hiddenClosingTerminalKeys.has(terminalKey)) return
    const worktreeTerminalKey = session.descriptor.worktreeTerminalKey
    const visibleTerminalKeysBeforeClose = this.visibleSessionsForWorktree(worktreeTerminalKey).map(
      (item) => item.descriptor.terminalKey,
    )
    const wasSelected = this.selectedTerminalKeyByWorktree.get(worktreeTerminalKey) === terminalKey
    this.hiddenClosingTerminalKeys.add(terminalKey)
    if (wasSelected) {
      const nextTerminalKey = resolveAdjacentTerminalSelectionAfterRemoval(visibleTerminalKeysBeforeClose, terminalKey)
      this.selectTerminalKey(worktreeTerminalKey, nextTerminalKey, { notify: false })
    }
    this.notifyWorktree(worktreeTerminalKey)
  }

  private restoreClosingSession(terminalKey: string, session: TerminalSession): void {
    if (this.sessions.get(terminalKey) !== session) return
    const worktreeTerminalKey = session.descriptor.worktreeTerminalKey
    if (!this.hiddenClosingTerminalKeys.delete(terminalKey)) return
    if (!this.selectedTerminalKeyByWorktree.has(worktreeTerminalKey)) {
      this.selectTerminalKey(worktreeTerminalKey, terminalKey, { notify: false })
    }
    this.notifyWorktree(worktreeTerminalKey)
  }

  private discardLocalSessionAndDismissDetailIfLast(terminalKey: string, base: TerminalSessionBase): void {
    const session = this.sessions.get(terminalKey)
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    if (!session || session.descriptor.worktreeTerminalKey !== terminalWorktreeKey) return
    this.removeSession(terminalKey, { dispose: true, closeSession: false })
  }

  private syncDescriptorsFromRepoIndex(): void {
    const changedWorktrees = new Set<string>()
    for (const session of this.sessions.values()) {
      const branch = branchForTerminalWorktree(
        this.repoIndex,
        session.descriptor.repoRoot,
        session.descriptor.worktreePath,
      )
      if (!branch || branch === session.descriptor.branch) continue
      session.updateDescriptor({ ...session.descriptor, branch })
      changedWorktrees.add(session.descriptor.worktreeTerminalKey)
    }
    for (const worktreeTerminalKey of changedWorktrees) this.notifyWorktree(worktreeTerminalKey)
  }

  private pruneSessionsMissingFromRepoIndex(): void {
    const terminalKeysToRemove = Array.from(this.sessions.entries())
      .filter(([, session]) => !this.repoIndex[session.descriptor.repoRoot])
      .map(([terminalKey]) => terminalKey)
    for (const terminalKey of terminalKeysToRemove)
      this.removeSession(terminalKey, { dispose: true, closeSession: false })
  }

  private ensureSession(descriptor: TerminalDescriptor): TerminalSession {
    const current = this.sessions.get(descriptor.terminalKey)
    if (current) {
      current.updateDescriptor(descriptor)
      this.syncPtySessionIdIndex(
        descriptor.terminalKey,
        current.currentPtySessionId() ?? this.ptySessionIdByTerminalKey.get(descriptor.terminalKey) ?? null,
      )
      this.notifyWorktree(descriptor.worktreeTerminalKey)
      return current
    }
    const session = new TerminalSession(
      descriptor,
      () => this.notifySession(descriptor.terminalKey),
      this.bellState.handleBell,
      (ptySessionId) => this.enqueueDurableClose({ ptySessionId, worktreeTerminalKey: descriptor.worktreeTerminalKey }),
    )
    this.sessions.set(descriptor.terminalKey, session)
    this.syncPtySessionIdIndex(descriptor.terminalKey, session.currentPtySessionId())
    this.snapshotCache.set(descriptor.terminalKey, session.snapshot())
    if (!this.selectedTerminalKeyByWorktree.has(descriptor.worktreeTerminalKey)) {
      const preferred = this.preferredSelectedTerminalKeyByWorktree.get(descriptor.worktreeTerminalKey)
      if (!preferred || preferred === descriptor.terminalKey)
        this.selectTerminalKey(descriptor.worktreeTerminalKey, descriptor.terminalKey, { notify: false })
    }
    this.notifyWorktree(descriptor.worktreeTerminalKey)
    return session
  }

  private selectTerminalKey(
    worktreeTerminalKey: string,
    terminalKey: string | null,
    options: { notify?: boolean } = {},
  ): void {
    const next = terminalKey && this.isSelectedTerminalKeyValid(worktreeTerminalKey, terminalKey) ? terminalKey : null
    const current = this.selectedTerminalKeyByWorktree.get(worktreeTerminalKey) ?? null
    if (current === next) {
      this.setPreferredSelectedTerminalKey(worktreeTerminalKey, next)
      return
    }
    if (next) {
      this.selectedTerminalKeyByWorktree.set(worktreeTerminalKey, next)
    } else {
      this.selectedTerminalKeyByWorktree.delete(worktreeTerminalKey)
    }
    this.setPreferredSelectedTerminalKey(worktreeTerminalKey, next)
    if (options.notify !== false) this.notifyWorktree(worktreeTerminalKey)
  }

  private setPreferredSelectedTerminalKey(worktreeTerminalKey: string, terminalKey: string | null): void {
    const current = this.preferredSelectedTerminalKeyByWorktree.get(worktreeTerminalKey) ?? null
    if (current === terminalKey) return
    if (terminalKey) this.preferredSelectedTerminalKeyByWorktree.set(worktreeTerminalKey, terminalKey)
    else this.preferredSelectedTerminalKeyByWorktree.delete(worktreeTerminalKey)
    this.onSelectedWorktreeChange(worktreeTerminalKey, terminalKey)
  }

  private isSelectedTerminalKeyValid(worktreeTerminalKey: string, terminalKey: string): boolean {
    return (
      !this.hiddenClosingTerminalKeys.has(terminalKey) &&
      this.sessions.get(terminalKey)?.descriptor.worktreeTerminalKey === worktreeTerminalKey
    )
  }

  private visibleSessionsForWorktree(worktreeTerminalKey: string): TerminalSession[] {
    return this.sortedSessionsForWorktree(worktreeTerminalKey).filter(
      (session) => !this.hiddenClosingTerminalKeys.has(session.descriptor.terminalKey),
    )
  }

  private sortedSessionsForWorktree(worktreeTerminalKey: string): TerminalSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.descriptor.worktreeTerminalKey === worktreeTerminalKey)
      .sort((a, b) => {
        const orderA = terminalSessionDisplayOrder(a.descriptor, this.displayOrderByTerminalKey)
        const orderB = terminalSessionDisplayOrder(b.descriptor, this.displayOrderByTerminalKey)
        return orderA - orderB || a.descriptor.index - b.descriptor.index
      })
  }
}

export interface TerminalSessionProjectionDeps {
  onSelectedWorktreeChange: (worktreeTerminalKey: string, terminalKey: string | null) => void
  onTerminalSessionRemoved?: (terminalKey: string, base: TerminalSessionBase) => void
  onTerminalSessionsMaterialized?: (base: TerminalSessionBase, terminalKeys: readonly string[]) => void
}

let projectionInstance: TerminalSessionProjection | null = null

/**
 * Lazy getter for the client-level terminal session projection.
 *
 * First call constructs the singleton with `deps` (only the first
 * call's deps are honored — subsequent calls return the existing
 * instance even if deps differ, because the singleton is meant to
 * outlive any Provider remount). The Provider is the canonical
 * caller; tests inject via `setTerminalSessionProjectionForTests`.
 *
 * Mirrors the `getClientBridge()` shape at
 * `src/web/client-bridge.ts`.
 */
export function getTerminalSessionProjection(deps: TerminalSessionProjectionDeps): TerminalSessionProjection {
  if (!projectionInstance) {
    projectionInstance = new TerminalSessionProjection(
      deps.onSelectedWorktreeChange,
      deps.onTerminalSessionRemoved,
      deps.onTerminalSessionsMaterialized,
    )
  }
  return projectionInstance
}

/**
 * Test seam: install or clear the singleton projection. Tests should:
 *
 * 1. In `beforeEach`: construct a fresh `TerminalSessionProjection` and
 *    install it with `setTerminalSessionProjectionForTests(instance)`.
 * 2. In `afterEach`: call `setTerminalSessionProjectionForTests(null)`.
 *    If the per-test instance needs to drain pending promises or
 *    clear listener maps, call `projection.destroy()` on the local
 *    reference before clearing the session.
 *
 * Production code never calls this. Mirrors
 * `setClientBridgeForTests()` at `src/web/client-bridge.ts`.
 */
export function setTerminalSessionProjectionForTests(instance: TerminalSessionProjection | null): void {
  projectionInstance = instance
}
