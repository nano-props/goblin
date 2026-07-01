import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import { TerminalSession } from '#/web/components/terminal/TerminalSession.ts'
import { createTerminalBellState } from '#/web/components/terminal/terminal-bell-state.ts'
import { createTerminalOutputActivityState } from '#/web/components/terminal/terminal-output-activity-state.ts'
import { formatTerminalWorktreeKey, parseTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { readOrCreateWebTerminalClientId } from '#/web/client-terminal-id.ts'
import type {
  TerminalBellRealtimeEvent,
  TerminalSessionSnapshot,
  TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import {
  projectCreateResultForClient,
  projectServerTerminalSession,
} from '#/web/components/terminal/terminal-session-projection.ts'
import { userTerminalInput, type TerminalUserInputSource } from '#/web/components/terminal/terminal-input.ts'
import {
  captureTerminalHostGeometry,
  resolveTerminalStartupGeometryHint,
} from '#/web/components/terminal/terminal-session-geometry.ts'
import { TerminalSessionLifecycleQueues } from '#/web/components/terminal/terminal-session-lifecycle-queues.ts'
import { DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS } from '#/web/components/terminal/terminal-geometry.ts'
import {
  countOrphanedTerminalSessionIds,
  resolveAdjacentTerminalSelectionAfterRemoval,
} from '#/web/components/terminal/terminal-session-eviction.ts'
import { syncTerminalPtySessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'
import { resolveSelectedTerminalSessionId } from '#/web/components/terminal/terminal-session-selection.ts'
import { buildTerminalWorktreeSnapshot } from '#/web/components/terminal/terminal-session-worktree-snapshot.ts'
import { runWorkspacePaneTabsOperation } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'
import {
  fetchWorkspacePaneTabsForTarget,
  invalidateWorkspacePaneTabs,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type {
  TerminalDescriptor,
  TerminalCreateOptions,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalRepoIndex,
  TerminalWorktreeSnapshot,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  canonicalTitle: null,
}
const EMPTY_SERVER_SNAPSHOTS = new Map<string, TerminalSessionSnapshot>()
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
 * (per-worktree session lists, bell controller, startup geometry hints,
 * selector snapshot caches, pending create/close queues) that has no
 * natural React tree boundary. The previous Provider-owned lifetime
 * required a `pendingProjectionDestroyRef + setTimeout(0)` debounce to
 * survive StrictMode; the singleton removes that dance entirely.
 */
export class TerminalSessionProjection {
  private readonly onSelectedWorktreeChange: (terminalWorktreeKey: string, terminalSessionId: string | null) => void
  private readonly onWorkspaceTabsChanged: (base: TerminalSessionBase, tabs: readonly WorkspacePaneTabEntry[]) => void
  private repoIndex: TerminalRepoIndex = {}
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly terminalSessionIdByPtySessionId = new Map<string, string>()
  private readonly ptySessionIdByTerminalSessionId = new Map<string, string>()
  // Client preference only: server owns session existence/control, while
  // each client chooses which terminal to present for a worktree.
  private readonly selectedTerminalSessionIdByTerminalWorktree = new Map<string, string>()
  private readonly preferredSelectedTerminalSessionIdByTerminalWorktree = new Map<string, string>()
  private readonly hostByWorktree = new Map<string, HTMLElement>()
  private readonly startupGeometryHintByWorktree = new Map<string, { cols: number; rows: number }>()
  // Owns pending create and durable close promises. The projection decides
  // when to drain them; the helper owns dedupe and settle mechanics.
  private readonly lifecycleQueues = new TerminalSessionLifecycleQueues<TerminalSessionBase, TerminalCreateOptions>()
  // Durable close queue rationale. `TerminalSession.dispose` used to fire
  // `terminalBridge.close({ ptySessionId })` as a `void ... .catch(() => {})`
  // — if the WebSocket was already closing (or `closeSocketIfIdle` raced
  // the request), the request was rejected before the server saw it and
  // the PTY stayed alive. The next `createTerminal` then reattached to
  // the orphan and printed the previous shell's `Restored session: …`
  // line a second time.
  //
  // Enqueue stores a promise, the background close settles it, and
  // `flushPendingCreate` awaits closes for the same worktree before
  // creating so the session service cannot reattach to an orphan.
  // Failures are logged (the old path swallowed them silently) so any
  // future regression is visible in `terminalLog` rather than invisible
  // shell ghosts in the buffer.
  // User-initiated close hides the session from worktree snapshots
  // synchronously while server cleanup runs. This is terminal-runtime
  // visibility, not workspace pane selection state.
  private readonly hiddenClosingTerminalSessionIds = new Set<string>()
  private readonly closeCompletionByTerminalSessionId = new Map<string, Promise<boolean>>()
  // Selector publication caches only. They memoize lightweight UI snapshots
  // for React subscribers and do not contain terminal render buffers.
  private readonly snapshotCache = new Map<string, TerminalSnapshot>()
  private readonly worktreeSnapshotCache = new Map<string, TerminalWorktreeSnapshot>()
  private readonly worktreeListeners = new Map<string, Set<() => void>>()
  private readonly repoBellCountListeners = new Map<string, Set<() => void>>()
  // Selector publication cache only. The unread bell source of truth
  // stays in `bellState`; this stores the last count delivered to
  // repo-level subscribers so unrelated worktree events do not wake
  // the repo picker.
  private readonly lastPublishedRepoBellCountByRepo = new Map<string, number>()
  private readonly snapshotListeners = new Map<string, Set<() => void>>()
  private readonly terminalSessionIdsByTerminalWorktree = new Map<string, string[]>()
  private readonly pendingServerBellByTerminalSessionId = new Map<string, TerminalBellRealtimeEvent>()
  private readonly bellState = createTerminalBellState(
    (terminalSessionId) => {
      if (terminalSessionId) {
        const terminalWorktreeKey = this.sessions.get(terminalSessionId)?.descriptor.terminalWorktreeKey
        if (terminalWorktreeKey) this.notifyWorktree(terminalWorktreeKey)
        return
      }
      this.notifyAllWorktrees()
      this.notifyAllRepoBellCounts()
    },
    (count) => terminalBridge.setBadge(count),
  )
  private readonly outputActivityState = createTerminalOutputActivityState((terminalWorktreeKey) =>
    this.notifyWorktree(terminalWorktreeKey),
  )

  constructor(
    onSelectedWorktreeChange: (terminalWorktreeKey: string, terminalSessionId: string | null) => void = () => {},
    onWorkspaceTabsChanged: (base: TerminalSessionBase, tabs: readonly WorkspacePaneTabEntry[]) => void = () => {},
  ) {
    this.onSelectedWorktreeChange = onSelectedWorktreeChange
    this.onWorkspaceTabsChanged = onWorkspaceTabsChanged
  }

  setRepoIndex(repoIndex: TerminalRepoIndex): void {
    this.repoIndex = repoIndex
    this.pruneSessionsMissingFromRepoIndex()
    this.syncDescriptorsFromRepoIndex()
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
    this.lifecycleQueues.rejectAll(new Error('terminal session projection destroyed'))
    for (const session of this.sessions.values()) session.dispose({ closeSession: false })
    this.sessions.clear()
    this.terminalSessionIdByPtySessionId.clear()
    this.ptySessionIdByTerminalSessionId.clear()
    this.selectedTerminalSessionIdByTerminalWorktree.clear()
    this.preferredSelectedTerminalSessionIdByTerminalWorktree.clear()
    this.hostByWorktree.clear()
    this.startupGeometryHintByWorktree.clear()
    this.hiddenClosingTerminalSessionIds.clear()
    this.closeCompletionByTerminalSessionId.clear()
    this.snapshotCache.clear()
    this.worktreeSnapshotCache.clear()
    this.worktreeListeners.clear()
    this.repoBellCountListeners.clear()
    this.lastPublishedRepoBellCountByRepo.clear()
    this.snapshotListeners.clear()
    this.terminalSessionIdsByTerminalWorktree.clear()
    this.pendingServerBellByTerminalSessionId.clear()
    this.bellState.reset()
    this.outputActivityState.reset()
    if (projectionInstance === this) projectionInstance = null
  }

  handleOutput(event: { ptySessionId: string; data: string; seq: number; processName: string }): void {
    const directKey = this.terminalSessionIdByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directKey && directSession) {
      if (event.data.length > 0)
        this.outputActivityState.markOutput(directKey, directSession.descriptor.terminalWorktreeKey)
      directSession.handleOutput(event)
    }
  }

  handleServerBell(event: TerminalBellRealtimeEvent): void {
    const session =
      this.sessions.get(event.terminalSessionId) ??
      this.sessions.get(this.terminalSessionIdByPtySessionId.get(event.ptySessionId) ?? '')
    if (!session) {
      this.pendingServerBellByTerminalSessionId.set(event.terminalSessionId, event)
      return
    }
    this.applyServerBell(session, event)
  }

  private applyServerBell(session: TerminalSession, event: TerminalBellRealtimeEvent): void {
    this.pendingServerBellByTerminalSessionId.delete(event.terminalSessionId)
    this.bellState.handleBell(session.descriptor, {
      processName: event.processName,
      canonicalTitle: event.canonicalTitle,
      visible: session.isVisible(),
    })
  }

  handleServerTitle(event: { ptySessionId: string; canonicalTitle: string | null }): void {
    const directKey = this.terminalSessionIdByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleServerTitle(event.canonicalTitle)
    }
  }

  handleExit(event: { ptySessionId: string }): void {
    const directKey = this.terminalSessionIdByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directKey && directSession?.handleExit(event)) {
      // Local runtime accepted the exit. Gating the discard on the
      // runtime's accept (rather than evicting eagerly on the
      // ptySessionId match) avoids discarding a live local session
      // during a race where the session has moved to a new ptySessionId
      // (e.g. after a server-side restart) but the index still maps the
      // old ptySessionId to the same terminalSessionId.
      this.discardLocalSessionAndDismissDetailIfLast(directKey, directSession.descriptor)
      return
    }
    if (directKey && directSession && !directSession.currentPtySessionId()) {
      // The runtime is empty (exit was observed earlier, or the
      // session was never attached) but the ptySessionId index still
      // points at it. Drop the local projection; future render recovery
      // comes from the server snapshot, not a client-side render cache.
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
    const directKey = this.terminalSessionIdByPtySessionId.get(ptySessionId)
    if (!directKey) return
    const session = this.sessions.get(directKey)
    if (!session) return
    this.discardLocalSessionAndDismissDetailIfLast(directKey, session.descriptor)
  }

  handleIdentity(event: TerminalIdentityViewModel): void {
    const directKey = this.terminalSessionIdByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleIdentity(event)
    }
  }

  handleLifecycle(event: TerminalLifecycleViewModel): void {
    const directKey = this.terminalSessionIdByPtySessionId.get(event.ptySessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleLifecycle(event)
    }
  }

  reconcileServerSessions(
    repoRoot: string,
    serverSessions: ServerTerminalSessionSummary[],
    clientId: string,
    snapshotsByPtySessionId: ReadonlyMap<string, TerminalSessionSnapshot> = EMPTY_SERVER_SNAPSHOTS,
  ): void {
    if (!this.repoIndex[repoRoot]) return

    const { controllerTerminalSessionIdByWorktree, touchedWorktrees, tabsChangedWorktrees } =
      this.materializeServerSessions(repoRoot, serverSessions, clientId, snapshotsByPtySessionId)

    const serverTerminalSessionIds = new Set(serverSessions.map((session) => session.terminalSessionId))
    this.evictOrphanedLocalSessions(repoRoot, serverTerminalSessionIds)

    this.resolveSelectedTerminalSessionIdsForTouchedWorktrees(touchedWorktrees, controllerTerminalSessionIdByWorktree)
    for (const terminalWorktreeKey of tabsChangedWorktrees) {
      this.notifyWorktree(terminalWorktreeKey)
    }
  }

  // Phase 1: for each server session, ensure a local TerminalSession
  // exists, hydrate it with the latest server-side metadata, and track
  // which worktrees saw any change. Side effects: ensureSession,
  // session.hydrate, terminalSessionIdsByTerminalWorktree, syncPtySessionIdIndex.
  private materializeServerSessions(
    repoRoot: string,
    serverSessions: ServerTerminalSessionSummary[],
    clientId: string,
    snapshotsByPtySessionId: ReadonlyMap<string, TerminalSessionSnapshot>,
  ): {
    controllerTerminalSessionIdByWorktree: Map<string, string>
    touchedWorktrees: Set<string>
    tabsChangedWorktrees: Set<string>
  } {
    const controllerTerminalSessionIdByWorktree = new Map<string, string>()
    const touchedWorktrees = new Set<string>()
    const terminalSessionIdsByTouchedWorktree = new Map<string, string[]>()
    const nextIndexByWorktree = new Map<string, number>()

    for (const serverSession of serverSessions) {
      const terminalWorktreeKey = formatTerminalWorktreeKey(serverSession.repoRoot, serverSession.worktreePath)
      const index = (nextIndexByWorktree.get(terminalWorktreeKey) ?? 0) + 1
      const projected = projectServerTerminalSession({
        repoIndex: this.repoIndex,
        repoRoot,
        serverSession,
        clientId,
        index,
        serverSnapshot: snapshotsByPtySessionId.get(serverSession.ptySessionId) ?? null,
      })
      if (!projected) continue
      touchedWorktrees.add(projected.terminalWorktreeKey)
      nextIndexByWorktree.set(projected.terminalWorktreeKey, index)
      const descriptor = projected.descriptor
      const session = this.ensureSession(descriptor)
      session.hydrate(projected.hydrateInput)
      this.syncPtySessionIdIndex(descriptor.terminalSessionId, projected.hydrateInput.ptySessionId)
      const pendingBell = this.pendingServerBellByTerminalSessionId.get(descriptor.terminalSessionId)
      if (pendingBell) this.applyServerBell(session, pendingBell)
      if (projected.controlsTerminal)
        controllerTerminalSessionIdByWorktree.set(projected.terminalWorktreeKey, descriptor.terminalSessionId)
      pushUniqueMapList(
        terminalSessionIdsByTouchedWorktree,
        projected.terminalWorktreeKey,
        descriptor.terminalSessionId,
      )
    }

    const tabsChangedWorktrees = this.replaceTerminalSessionIdListForTouchedWorktrees(
      terminalSessionIdsByTouchedWorktree,
    )
    return { controllerTerminalSessionIdByWorktree, touchedWorktrees, tabsChangedWorktrees }
  }

  // Phase 2: drop local sessions that have a serverId but no longer
  // appear on the server. Only sessions that have ever been attached
  // (i.e. have a ptySessionId in our index) are eligible for eviction;
  // never-attached local shells (purely UI placeholders) are left
  // alone. Returns the count for the debug log.
  private evictOrphanedLocalSessions(repoRoot: string, serverTerminalSessionIds: Set<string>): number {
    const orphanedTerminalSessionIds = countOrphanedTerminalSessionIds({
      repoRoot,
      localTerminalSessionIds: Array.from(this.sessions.keys()),
      getRepoRootForTerminalSessionId: (terminalSessionId) =>
        this.sessions.get(terminalSessionId)?.descriptor.repoRoot ?? null,
      hasPtySessionIdForTerminalSessionId: (terminalSessionId) =>
        this.ptySessionIdByTerminalSessionId.has(terminalSessionId),
      serverTerminalSessionIds,
    })
    for (const terminalSessionId of orphanedTerminalSessionIds) {
      const session = this.sessions.get(terminalSessionId)
      if (!session) continue
      this.discardLocalSessionAndDismissDetailIfLast(terminalSessionId, session.descriptor)
    }
    return orphanedTerminalSessionIds.length
  }

  // Phase 3: for every worktree that saw a server-side change, decide
  // which local terminal should be selected. The selection prefers the
  // controller of the worktree, then the user's last selection, then
  // the first available terminal.
  private resolveSelectedTerminalSessionIdsForTouchedWorktrees(
    touchedWorktrees: Set<string>,
    controllerTerminalSessionIdByWorktree: Map<string, string>,
  ): void {
    for (const terminalWorktreeKey of touchedWorktrees) {
      const current = this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) ?? null
      const preferred = this.preferredSelectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) ?? null
      const next = resolveSelectedTerminalSessionId({
        terminalWorktreeKey,
        preferredSessionId: preferred,
        currentSessionId: current,
        controllerSessionId: controllerTerminalSessionIdByWorktree.get(terminalWorktreeKey) ?? null,
        sortedDescriptors: this.visibleSessionsForWorktree(terminalWorktreeKey).map((session) => session.descriptor),
        isSelectedTerminalSessionIdValid: (candidateTerminalWorktreeKey, terminalSessionId) =>
          this.isSelectedTerminalSessionIdValid(candidateTerminalWorktreeKey, terminalSessionId),
      })
      this.selectTerminalSessionId(terminalWorktreeKey, next)
    }
  }

  createTerminal = (base: TerminalSessionBase, options: TerminalCreateOptions = {}): Promise<string> =>
    this.enqueuePendingCreate(base, formatTerminalWorktreeKey(base.repoRoot, base.worktreePath), options)

  registerHost = (terminalWorktreeKey: string, host: HTMLElement): void => {
    this.hostByWorktree.set(terminalWorktreeKey, host)
    captureTerminalHostGeometry({
      terminalWorktreeKey,
      hostByWorktree: this.hostByWorktree,
      startupGeometryHintByWorktree: this.startupGeometryHintByWorktree,
    })
  }

  unregisterHost = (terminalWorktreeKey: string, host: HTMLElement): void => {
    if (this.hostByWorktree.get(terminalWorktreeKey) !== host) return
    this.hostByWorktree.delete(terminalWorktreeKey)
  }

  private async performCreateTerminal(
    base: TerminalSessionBase,
    geometry: { cols: number; rows: number },
    options: TerminalCreateOptions,
  ): Promise<string> {
    return await runWorkspacePaneTabsOperation(
      {
        repoRoot: base.repoRoot,
        branchName: base.branch,
        worktreePath: base.worktreePath,
      },
      async () => await this.performCreateTerminalNow(base, geometry, options),
    )
  }

  private async performCreateTerminalNow(
    base: TerminalSessionBase,
    geometry: { cols: number; rows: number },
    options: TerminalCreateOptions,
  ): Promise<string> {
    const clientId = readOrCreateWebTerminalClientId()
    const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
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
    const projectedCreate = projectCreateResultForClient(base, result)
    this.onWorkspaceTabsChanged(base, result.tabs)
    this.setPreferredSelectedTerminalSessionId(terminalWorktreeKey, result.terminalSessionId)
    this.reconcileServerSessions(
      base.repoRoot,
      projectedCreate.serverSessions,
      clientId,
      projectedCreate.snapshotByPtySessionId,
    )
    return result.terminalSessionId
  }

  private startupGeometryHint(terminalWorktreeKey: string): { cols: number; rows: number } {
    return (
      resolveTerminalStartupGeometryHint({
        terminalWorktreeKey,
        hostByWorktree: this.hostByWorktree,
        startupGeometryHintByWorktree: this.startupGeometryHintByWorktree,
        selectedDescriptor: this.selectedDescriptor(terminalWorktreeKey),
        getAttachmentSnapshot: (terminalSessionId) => this.snapshot(terminalSessionId).attachment,
      }) ?? { cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS }
    )
  }

  private enqueuePendingCreate(
    base: TerminalSessionBase,
    terminalWorktreeKey: string,
    options: TerminalCreateOptions,
  ): Promise<string> {
    const promise = this.lifecycleQueues.enqueueCreate({
      terminalWorktreeKey,
      base,
      options,
      isSameRequest: (existing, next) => existing.startupShellCommand === next.startupShellCommand,
      flush: (key) => {
        void this.flushPendingCreate(key)
      },
    })
    this.notifyWorktree(terminalWorktreeKey)
    return promise
  }

  private async flushPendingCreate(terminalWorktreeKey: string): Promise<void> {
    const pending = this.lifecycleQueues.getCreate(terminalWorktreeKey)
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
      await this.flushPendingClosesForWorktree(terminalWorktreeKey)
      if (this.lifecycleQueues.getCreate(terminalWorktreeKey) !== pending) {
        throw new Error('terminal create request canceled')
      }
      const geometry = this.startupGeometryHint(terminalWorktreeKey)
      if (this.lifecycleQueues.getCreate(terminalWorktreeKey) !== pending) {
        throw new Error('terminal create request canceled')
      }
      pending.creating = true
      pending.resolve(await this.performCreateTerminal(pending.base, geometry, pending.options))
    } catch (error) {
      pending.reject(error)
    } finally {
      pending.creating = false
      if (this.lifecycleQueues.deleteCreate(terminalWorktreeKey, pending)) {
        this.notifyWorktree(terminalWorktreeKey)
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
  enqueueDurableClose(input: {
    ptySessionId: string
    repoRoot: string
    branchName: string
    worktreePath: string
    terminalWorktreeKey: string
  }): Promise<void> {
    return this.lifecycleQueues.enqueueClose(input, async (closeInput) => await this.performDurableClose(closeInput))
  }

  // Awaited at the top of `createTerminal` for the same worktree.
  // Drains every in-flight close targeting `terminalWorktreeKey` so
  // the session service sees a clean slate. Failures are swallowed at this
  // seam: the user is about to create, and a stuck close should not
  // block them — the failure is already logged inside
  // `performDurableClose` and the user can `pruneTerminals` from the
  // UI to recover if the orphan ever resurfaces.
  private async flushPendingClosesForWorktree(terminalWorktreeKey: string): Promise<void> {
    if (!this.lifecycleQueues.hasCloses()) return
    const pendingForWorktree = this.lifecycleQueues.closesForWorktree(terminalWorktreeKey)
    if (pendingForWorktree.length === 0) return
    await Promise.allSettled(pendingForWorktree.map((entry) => entry.promise))
  }

  private async performDurableClose(input: {
    ptySessionId: string
    repoRoot: string
    branchName: string
    worktreePath: string
  }): Promise<void> {
    const { ptySessionId } = input
    try {
      await runWorkspacePaneTabsOperation(
        {
          repoRoot: input.repoRoot,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
        },
        async () => {
          await terminalBridge.close({ ptySessionId })
          try {
            invalidateWorkspacePaneTabs(input.repoRoot)
            await fetchWorkspacePaneTabsForTarget({
              repoRoot: input.repoRoot,
              branchName: input.branchName,
              worktreePath: input.worktreePath,
            })
          } catch (err) {
            terminalSessionProviderLog.warn('workspace pane tabs refresh failed after terminal close', {
              repoRoot: input.repoRoot,
              worktreePath: input.worktreePath,
              err,
            })
          }
        },
      )
    } catch (err) {
      // The old fire-and-forget path swallowed this rejection. Loud
      // logging is intentional: the failure mode (orphan PTY surviving
      // a tab close) is otherwise invisible to operators and surfaces
      // only as a confused user re-opening a tab and seeing the prior
      // shell's `Restored session: …` line print twice.
      terminalSessionProviderLog.warn('durable close failed for terminal session', { ptySessionId, err })
      throw err
    }
  }

  private async settlePendingCreateForWorktree(terminalWorktreeKey: string): Promise<void> {
    const pending = this.lifecycleQueues.getCreate(terminalWorktreeKey)
    if (!pending) return
    if (!pending.creating) {
      const error = new Error('terminal create request canceled')
      if (this.lifecycleQueues.deleteCreate(terminalWorktreeKey, pending)) {
        pending.reject(error)
        this.notifyWorktree(terminalWorktreeKey)
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

  private async waitForPendingClosesForWorktree(terminalWorktreeKey: string): Promise<boolean> {
    const pendingForWorktree = this.lifecycleQueues.closesForWorktree(terminalWorktreeKey)
    if (pendingForWorktree.length === 0) return true
    const results = await Promise.allSettled(pendingForWorktree.map((entry) => entry.promise))
    return results.every((result) => result.status === 'fulfilled')
  }

  private selectedDescriptor(terminalWorktreeKey: string): TerminalDescriptor | null {
    const selectedKey = this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey)
    if (selectedKey && this.hiddenClosingTerminalSessionIds.has(selectedKey)) return null
    return selectedKey ? (this.sessions.get(selectedKey)?.descriptor ?? null) : null
  }

  setPreferredSelectedTerminalSessionIds(selectedKeysByWorktree: Record<string, string>): void {
    const nextPreferred = new Map(Object.entries(selectedKeysByWorktree))
    const worktrees = new Set<string>([
      ...Array.from(this.preferredSelectedTerminalSessionIdByTerminalWorktree.keys()),
      ...Array.from(nextPreferred.keys()),
      ...Array.from(this.selectedTerminalSessionIdByTerminalWorktree.keys()),
    ])
    this.preferredSelectedTerminalSessionIdByTerminalWorktree.clear()
    for (const [terminalWorktreeKey, terminalSessionId] of nextPreferred)
      this.preferredSelectedTerminalSessionIdByTerminalWorktree.set(terminalWorktreeKey, terminalSessionId)
    for (const terminalWorktreeKey of worktrees) {
      const preferred = this.preferredSelectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) ?? null
      if (!preferred || !this.isSelectedTerminalSessionIdValid(terminalWorktreeKey, preferred)) continue
      this.selectTerminalSessionId(terminalWorktreeKey, preferred)
    }
  }

  terminalWorktreeSnapshot = (terminalWorktreeKey: string): TerminalWorktreeSnapshot => {
    const cached = this.worktreeSnapshotCache.get(terminalWorktreeKey)
    if (cached) return cached
    const snapshot = buildTerminalWorktreeSnapshot({
      terminalWorktreeKey,
      selectedDescriptor: this.selectedDescriptor(terminalWorktreeKey),
      pendingCreate: this.lifecycleQueues.hasCreate(terminalWorktreeKey),
      sessions: this.visibleSessionsForWorktree(terminalWorktreeKey),
      selectedTerminalSessionId: this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) ?? null,
      getCachedSnapshot: (terminalSessionId) => this.snapshotCache.get(terminalSessionId) ?? null,
      cacheSnapshot: (terminalSessionId, nextSnapshot) => this.snapshotCache.set(terminalSessionId, nextSnapshot),
      hasBell: (terminalSessionId) => this.bellState.hasBell(terminalSessionId),
      hasRecentOutput: (terminalSessionId) => this.outputActivityState.hasRecentOutput(terminalSessionId),
    })
    this.worktreeSnapshotCache.set(terminalWorktreeKey, snapshot)
    return snapshot
  }

  subscribeTerminalWorktree = (terminalWorktreeKey: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.worktreeListeners, terminalWorktreeKey, listener)
  }

  repoBellCount = (repoRoot: string): number => {
    let count = 0
    for (const session of this.sessions.values()) {
      const terminalSessionId = session.descriptor.terminalSessionId
      if (
        session.descriptor.repoRoot === repoRoot &&
        !this.hiddenClosingTerminalSessionIds.has(terminalSessionId) &&
        this.bellState.hasBell(terminalSessionId)
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

  selectTerminal = (terminalWorktreeKey: string, terminalSessionId: string): void => {
    const session = this.sessions.get(terminalSessionId)
    if (
      !session ||
      this.hiddenClosingTerminalSessionIds.has(terminalSessionId) ||
      session.descriptor.terminalWorktreeKey !== terminalWorktreeKey
    )
      return
    const wasSelected = this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) === terminalSessionId
    const hadBell = this.bellState.hasBell(terminalSessionId)
    if (wasSelected && !hadBell) return
    this.selectTerminalSessionId(terminalWorktreeKey, terminalSessionId, { notify: !hadBell })
    this.bellState.clear(terminalSessionId)
  }

  clearBell = (terminalSessionId: string): boolean => {
    return this.bellState.clear(terminalSessionId)
  }

  scrollToBottom = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.scrollToBottom()
  }

  scrollLines = (terminalSessionId: string, amount: number): void => {
    this.sessions.get(terminalSessionId)?.scrollLines(amount)
  }

  closeTerminalByDescriptor = async (terminalSessionId: string, base: TerminalSessionBase): Promise<boolean> => {
    const session = this.sessions.get(terminalSessionId)
    if (
      !session ||
      session.descriptor.terminalWorktreeKey !== formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
    )
      return false
    return await this.closeTerminal(terminalSessionId)
  }

  closeTerminalsForWorktree = async (base: TerminalSessionBase): Promise<boolean> => {
    const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
    await this.settlePendingCreateForWorktree(terminalWorktreeKey)
    const terminalSessionIds = this.sessionsForWorktreeList(terminalWorktreeKey).map(
      (session) => session.descriptor.terminalSessionId,
    )
    // When no terminal sessions exist there is nothing to release. Skip the
    // durable-close wait so a stale pending close (e.g. from an earlier tab
    // that already left the worktree) cannot block worktree removal.
    if (terminalSessionIds.length === 0) return true
    const results = await Promise.all(
      terminalSessionIds.map((terminalSessionId) => this.closeTerminal(terminalSessionId)),
    )
    const pendingClosesSettled = await this.waitForPendingClosesForWorktree(terminalWorktreeKey)
    return results.every(Boolean) && pendingClosesSettled
  }

  attach = (descriptor: TerminalDescriptor, host: HTMLElement): void => {
    this.ensureSession(descriptor).attach(host)
  }

  detach = (terminalSessionId: string, host: HTMLElement): void => {
    const session = this.sessions.get(terminalSessionId)
    session?.detach(host)
  }

  restart = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.restart()
  }

  focusTerminal = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.focus()
  }

  snapshot = (terminalSessionId: string): TerminalSnapshot => {
    const cached = this.snapshotCache.get(terminalSessionId)
    if (cached) return cached
    const session = this.sessions.get(terminalSessionId)
    if (!session) return EMPTY_TERMINAL_SNAPSHOT
    const next = session.snapshot()
    this.snapshotCache.set(terminalSessionId, next)
    return next
  }

  isKnownSession = (terminalSessionId: string): boolean => {
    return this.sessions.has(terminalSessionId)
  }

  subscribeSnapshot = (terminalSessionId: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.snapshotListeners, terminalSessionId, listener)
  }

  isTerminalFocusTarget = (terminalSessionId: string, target: EventTarget | null): boolean => {
    return this.sessions.get(terminalSessionId)?.isTerminalFocusTarget(target) ?? false
  }

  findNext = (terminalSessionId: string, term: string, incremental?: boolean) => {
    return (
      this.sessions.get(terminalSessionId)?.findNext(term, incremental) ?? {
        resultIndex: -1,
        resultCount: 0,
        found: false,
      }
    )
  }

  findPrevious = (terminalSessionId: string, term: string) => {
    return this.sessions.get(terminalSessionId)?.findPrevious(term) ?? { resultIndex: -1, resultCount: 0, found: false }
  }

  clearSearch = (terminalSessionId: string): void => {
    this.sessions.get(terminalSessionId)?.clearSearch()
  }

  writeInput = (terminalSessionId: string, data: string, source: TerminalUserInputSource = 'command'): void => {
    this.sessions.get(terminalSessionId)?.writeInput(userTerminalInput(data, source))
  }

  takeover = (terminalSessionId: string): Promise<boolean> => {
    const session = this.sessions.get(terminalSessionId)
    if (!session) return Promise.resolve(false)
    return session.takeover()
  }

  private notifyWorktree(terminalWorktreeKey: string): void {
    this.worktreeSnapshotCache.delete(terminalWorktreeKey)
    const listeners = this.worktreeListeners.get(terminalWorktreeKey)
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        try {
          listener()
        } catch (err) {
          terminalSessionProviderLog.warn('worktree listener threw', { terminalWorktreeKey, err })
        }
      }
    }
    const repoRoot = parseTerminalWorktreeKey(terminalWorktreeKey)?.repoRoot
    if (repoRoot) this.notifyRepoBellCountIfChanged(repoRoot)
  }

  private notifySnapshot(terminalSessionId: string): void {
    const listeners = this.snapshotListeners.get(terminalSessionId)
    if (!listeners) return
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch (err) {
        terminalSessionProviderLog.warn('snapshot listener threw', { terminalSessionId, err })
      }
    }
  }

  private notifyAllWorktrees(): void {
    for (const terminalWorktreeKey of Array.from(this.worktreeListeners.keys()))
      this.notifyWorktree(terminalWorktreeKey)
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

  private syncPtySessionIdIndex(terminalSessionId: string, ptySessionId: string | null): void {
    syncTerminalPtySessionIdIndex({
      terminalSessionId,
      ptySessionId,
      ptySessionIdByTerminalSessionId: this.ptySessionIdByTerminalSessionId,
      terminalSessionIdByPtySessionId: this.terminalSessionIdByPtySessionId,
    })
  }

  private notifySession(terminalSessionId: string): void {
    const session = this.sessions.get(terminalSessionId)
    this.syncPtySessionIdIndex(terminalSessionId, session?.currentPtySessionId() ?? null)
    if (session) {
      this.snapshotCache.set(terminalSessionId, session.snapshot())
    } else {
      this.snapshotCache.delete(terminalSessionId)
    }
    this.notifySnapshot(terminalSessionId)
    const terminalWorktreeKey = session?.descriptor.terminalWorktreeKey
    if (terminalWorktreeKey) this.notifyWorktree(terminalWorktreeKey)
  }

  private removeSession(terminalSessionId: string, options: { dispose: boolean; closeSession?: boolean }): boolean {
    const session = this.sessions.get(terminalSessionId)
    if (!session) return false
    const terminalWorktreeKey = session.descriptor.terminalWorktreeKey
    const visibleTerminalSessionIdsBeforeRemoval = this.visibleSessionsForWorktree(terminalWorktreeKey).map(
      (item) => item.descriptor.terminalSessionId,
    )
    const wasSelected = this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) === terminalSessionId
    this.hiddenClosingTerminalSessionIds.delete(terminalSessionId)
    this.closeCompletionByTerminalSessionId.delete(terminalSessionId)
    this.pendingServerBellByTerminalSessionId.delete(terminalSessionId)
    this.syncPtySessionIdIndex(terminalSessionId, null)
    this.sessions.delete(terminalSessionId)
    this.snapshotCache.delete(terminalSessionId)
    this.removeTerminalSessionIdFromWorktreeList(terminalWorktreeKey, terminalSessionId)
    this.outputActivityState.remove(terminalSessionId)
    this.notifySnapshot(terminalSessionId)
    this.bellState.remove(terminalSessionId)
    if (options.dispose) session.dispose({ closeSession: options.closeSession !== false })
    if (wasSelected) {
      const nextSessionId = resolveAdjacentTerminalSelectionAfterRemoval(
        visibleTerminalSessionIdsBeforeRemoval,
        terminalSessionId,
      )
      this.selectTerminalSessionId(terminalWorktreeKey, nextSessionId, { notify: false })
    }
    this.notifyWorktree(terminalWorktreeKey)
    return true
  }

  private async closeTerminal(terminalSessionId: string): Promise<boolean> {
    const pending = this.closeCompletionByTerminalSessionId.get(terminalSessionId)
    if (pending) return pending
    const session = this.sessions.get(terminalSessionId)
    if (!session) return false
    const promise = this.runClose(terminalSessionId, session)
    this.closeCompletionByTerminalSessionId.set(terminalSessionId, promise)
    const cleanup = () => {
      if (this.closeCompletionByTerminalSessionId.get(terminalSessionId) === promise)
        this.closeCompletionByTerminalSessionId.delete(terminalSessionId)
    }
    void promise.then(cleanup, cleanup)
    return promise
  }

  private async runClose(terminalSessionId: string, session: TerminalSession): Promise<boolean> {
    this.hideClosingSession(terminalSessionId, session)
    try {
      await session.closeServerResourcesAndWait()
    } catch (err) {
      terminalSessionProviderLog.warn('terminal close failed', { terminalSessionId, err })
      this.restoreClosingSession(terminalSessionId, session)
      return false
    }
    if (this.sessions.get(terminalSessionId) !== session) return true
    return this.removeSession(terminalSessionId, { dispose: true, closeSession: false })
  }

  private hideClosingSession(terminalSessionId: string, session: TerminalSession): void {
    if (this.hiddenClosingTerminalSessionIds.has(terminalSessionId)) return
    const terminalWorktreeKey = session.descriptor.terminalWorktreeKey
    const visibleSessionIdsBeforeClose = this.visibleSessionsForWorktree(terminalWorktreeKey).map(
      (item) => item.descriptor.terminalSessionId,
    )
    const wasSelected = this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) === terminalSessionId
    this.hiddenClosingTerminalSessionIds.add(terminalSessionId)
    if (wasSelected) {
      const nextSessionId = resolveAdjacentTerminalSelectionAfterRemoval(
        visibleSessionIdsBeforeClose,
        terminalSessionId,
      )
      this.selectTerminalSessionId(terminalWorktreeKey, nextSessionId, { notify: false })
    }
    this.notifyWorktree(terminalWorktreeKey)
  }

  private restoreClosingSession(terminalSessionId: string, session: TerminalSession): void {
    if (this.sessions.get(terminalSessionId) !== session) return
    const terminalWorktreeKey = session.descriptor.terminalWorktreeKey
    if (!this.hiddenClosingTerminalSessionIds.delete(terminalSessionId)) return
    if (!this.selectedTerminalSessionIdByTerminalWorktree.has(terminalWorktreeKey)) {
      this.selectTerminalSessionId(terminalWorktreeKey, terminalSessionId, { notify: false })
    }
    this.notifyWorktree(terminalWorktreeKey)
  }

  private discardLocalSessionAndDismissDetailIfLast(terminalSessionId: string, base: TerminalSessionBase): void {
    const session = this.sessions.get(terminalSessionId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
    if (!session || session.descriptor.terminalWorktreeKey !== terminalWorktreeKey) return
    this.removeSession(terminalSessionId, { dispose: true, closeSession: false })
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
      changedWorktrees.add(session.descriptor.terminalWorktreeKey)
    }
    for (const terminalWorktreeKey of changedWorktrees) this.notifyWorktree(terminalWorktreeKey)
  }

  private pruneSessionsMissingFromRepoIndex(): void {
    const sessionIdsToRemove = Array.from(this.sessions.entries())
      .filter(([, session]) => !this.repoIndex[session.descriptor.repoRoot])
      .map(([terminalSessionId]) => terminalSessionId)
    for (const terminalSessionId of sessionIdsToRemove)
      this.removeSession(terminalSessionId, { dispose: true, closeSession: false })
  }

  private ensureSession(descriptor: TerminalDescriptor): TerminalSession {
    const current = this.sessions.get(descriptor.terminalSessionId)
    this.appendTerminalSessionIdToWorktreeList(descriptor.terminalWorktreeKey, descriptor.terminalSessionId)
    if (current) {
      current.updateDescriptor(descriptor)
      this.syncPtySessionIdIndex(
        descriptor.terminalSessionId,
        current.currentPtySessionId() ?? this.ptySessionIdByTerminalSessionId.get(descriptor.terminalSessionId) ?? null,
      )
      this.notifyWorktree(descriptor.terminalWorktreeKey)
      return current
    }
    let session!: TerminalSession
    session = new TerminalSession(
      descriptor,
      () => this.notifySession(descriptor.terminalSessionId),
      (ptySessionId) =>
        this.enqueueDurableClose({
          ptySessionId,
          repoRoot: session.descriptor.repoRoot,
          branchName: session.descriptor.branch,
          worktreePath: session.descriptor.worktreePath,
          terminalWorktreeKey: session.descriptor.terminalWorktreeKey,
        }),
    )
    this.sessions.set(descriptor.terminalSessionId, session)
    this.syncPtySessionIdIndex(descriptor.terminalSessionId, session.currentPtySessionId())
    this.snapshotCache.set(descriptor.terminalSessionId, session.snapshot())
    if (!this.selectedTerminalSessionIdByTerminalWorktree.has(descriptor.terminalWorktreeKey)) {
      const preferred = this.preferredSelectedTerminalSessionIdByTerminalWorktree.get(descriptor.terminalWorktreeKey)
      if (!preferred || preferred === descriptor.terminalSessionId)
        this.selectTerminalSessionId(descriptor.terminalWorktreeKey, descriptor.terminalSessionId, { notify: false })
    }
    this.notifyWorktree(descriptor.terminalWorktreeKey)
    return session
  }

  private selectTerminalSessionId(
    terminalWorktreeKey: string,
    terminalSessionId: string | null,
    options: { notify?: boolean } = {},
  ): void {
    const next =
      terminalSessionId && this.isSelectedTerminalSessionIdValid(terminalWorktreeKey, terminalSessionId)
        ? terminalSessionId
        : null
    const current = this.selectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) ?? null
    if (current === next) {
      this.setPreferredSelectedTerminalSessionId(terminalWorktreeKey, next)
      return
    }
    if (next) {
      this.selectedTerminalSessionIdByTerminalWorktree.set(terminalWorktreeKey, next)
    } else {
      this.selectedTerminalSessionIdByTerminalWorktree.delete(terminalWorktreeKey)
    }
    this.setPreferredSelectedTerminalSessionId(terminalWorktreeKey, next)
    if (options.notify !== false) this.notifyWorktree(terminalWorktreeKey)
  }

  private setPreferredSelectedTerminalSessionId(terminalWorktreeKey: string, terminalSessionId: string | null): void {
    const current = this.preferredSelectedTerminalSessionIdByTerminalWorktree.get(terminalWorktreeKey) ?? null
    if (current === terminalSessionId) return
    if (terminalSessionId)
      this.preferredSelectedTerminalSessionIdByTerminalWorktree.set(terminalWorktreeKey, terminalSessionId)
    else this.preferredSelectedTerminalSessionIdByTerminalWorktree.delete(terminalWorktreeKey)
    this.onSelectedWorktreeChange(terminalWorktreeKey, terminalSessionId)
  }

  private isSelectedTerminalSessionIdValid(terminalWorktreeKey: string, terminalSessionId: string): boolean {
    return (
      !this.hiddenClosingTerminalSessionIds.has(terminalSessionId) &&
      this.sessions.get(terminalSessionId)?.descriptor.terminalWorktreeKey === terminalWorktreeKey
    )
  }

  private visibleSessionsForWorktree(terminalWorktreeKey: string): TerminalSession[] {
    return this.sessionsForWorktreeList(terminalWorktreeKey).filter(
      (session) => !this.hiddenClosingTerminalSessionIds.has(session.descriptor.terminalSessionId),
    )
  }

  private sessionsForWorktreeList(terminalWorktreeKey: string): TerminalSession[] {
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => session.descriptor.terminalWorktreeKey === terminalWorktreeKey,
    )
    const terminalSessionByTerminalSessionId = new Map(
      sessions.map((session) => [session.descriptor.terminalSessionId, session]),
    )
    const seen = new Set<string>()
    const listedSessions: TerminalSession[] = []
    for (const terminalSessionId of this.terminalSessionIdsByTerminalWorktree.get(terminalWorktreeKey) ?? []) {
      const session = terminalSessionByTerminalSessionId.get(terminalSessionId)
      if (!session || seen.has(terminalSessionId)) continue
      seen.add(terminalSessionId)
      listedSessions.push(session)
    }
    for (const session of sessions) {
      const terminalSessionId = session.descriptor.terminalSessionId
      if (seen.has(terminalSessionId)) continue
      seen.add(terminalSessionId)
      listedSessions.push(session)
    }
    return listedSessions
  }

  private appendTerminalSessionIdToWorktreeList(terminalWorktreeKey: string, terminalSessionId: string): void {
    const current = this.terminalSessionIdsByTerminalWorktree.get(terminalWorktreeKey)
    if (current?.includes(terminalSessionId)) return
    this.terminalSessionIdsByTerminalWorktree.set(terminalWorktreeKey, [...(current ?? []), terminalSessionId])
  }

  private removeTerminalSessionIdFromWorktreeList(terminalWorktreeKey: string, terminalSessionId: string): void {
    const current = this.terminalSessionIdsByTerminalWorktree.get(terminalWorktreeKey)
    if (!current) return
    const next = current.filter((candidate) => candidate !== terminalSessionId)
    if (next.length === current.length) return
    if (next.length === 0) this.terminalSessionIdsByTerminalWorktree.delete(terminalWorktreeKey)
    else this.terminalSessionIdsByTerminalWorktree.set(terminalWorktreeKey, next)
  }

  private replaceTerminalSessionIdListForTouchedWorktrees(
    nextByWorktree: ReadonlyMap<string, readonly string[]>,
  ): Set<string> {
    const changedWorktrees = new Set<string>()
    for (const [terminalWorktreeKey, terminalSessionIds] of nextByWorktree) {
      const next = uniqueNonEmptyStrings(terminalSessionIds)
      const current = this.terminalSessionIdsByTerminalWorktree.get(terminalWorktreeKey) ?? []
      if (stringArraysEqual(current, next)) continue
      if (next.length === 0) this.terminalSessionIdsByTerminalWorktree.delete(terminalWorktreeKey)
      else this.terminalSessionIdsByTerminalWorktree.set(terminalWorktreeKey, next)
      changedWorktrees.add(terminalWorktreeKey)
    }
    return changedWorktrees
  }
}

function pushUniqueMapList(map: Map<string, string[]>, mapKey: string, value: string): void {
  const current = map.get(mapKey)
  if (!current) {
    map.set(mapKey, [value])
    return
  }
  if (!current.includes(value)) current.push(value)
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (value.length === 0 || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((value, index) => a[index] === value)
}

export interface TerminalSessionProjectionDeps {
  onSelectedWorktreeChange: (terminalWorktreeKey: string, terminalSessionId: string | null) => void
  onWorkspaceTabsChanged?: (base: TerminalSessionBase, tabs: readonly WorkspacePaneTabEntry[]) => void
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
    projectionInstance = new TerminalSessionProjection(deps.onSelectedWorktreeChange, deps.onWorkspaceTabsChanged)
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
