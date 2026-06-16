import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { ManagedTerminalSession } from '#/web/components/terminal/ManagedTerminalSession.ts'
import { createTerminalBellController } from '#/web/components/terminal/terminal-bell-controller.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import { parseTerminalSessionKey } from '#/shared/terminal-session-key.ts'
import type {
  TerminalSessionSnapshot,
  TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal-types.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import {
  projectServerTerminalSession,
  type ReattachSnapshotCacheEntry,
} from '#/web/components/terminal/terminal-session-projection.ts'
import {
  applyDisplayOrder,
  restoreDisplayOrder,
  snapshotDisplayOrder,
  terminalSessionDisplayOrder,
} from '#/web/components/terminal/terminal-session-display-order.ts'
import {
  captureTerminalHostGeometry,
  resolveTerminalCreateGeometry,
} from '#/web/components/terminal/terminal-session-geometry.ts'
import {
  countOrphanedTerminalSessionKeys,
  resolveAdjacentTerminalSelectionAfterRemoval,
} from '#/web/components/terminal/terminal-session-eviction.ts'
import { syncTerminalSessionIdIndex } from '#/web/components/terminal/terminal-session-index.ts'
import { resolveSelectedTerminalKey } from '#/web/components/terminal/terminal-session-selection.ts'
import { buildWorktreeTerminalSnapshot } from '#/web/components/terminal/terminal-session-worktree-snapshot.ts'
import type {
  TerminalDescriptor,
  TerminalRepoIndex,
  WorktreeTerminalSnapshot,
  TerminalSessionBase,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  canonicalTitle: null,
}
// Re-exported for any callers that still want the parser under its
// renderer-side name.
export const parseServerSessionKey = parseTerminalSessionKey

export class TerminalSessionRegistry {
  private repoIndex: TerminalRepoIndex = {}
  private parkingRoot: HTMLDivElement | null = null
  private readonly sessions = new Map<string, ManagedTerminalSession>()
  private readonly sessionKeyBySessionId = new Map<string, string>()
  private readonly sessionIdByKey = new Map<string, string>()
  private readonly selectedKeyByWorktree = new Map<string, string>()
  private readonly preferredSelectedKeyByWorktree = new Map<string, string>()
  private readonly hostByWorktree = new Map<string, HTMLElement>()
  private readonly geometryByWorktree = new Map<string, { cols: number; rows: number }>()
  private readonly pendingCreateByWorktree = new Map<
    string,
    {
      base: TerminalSessionBase
      promise: Promise<string>
      resolve: (key: string) => void
      reject: (error: unknown) => void
    }
  >()
  private readonly snapshotCache = new Map<string, TerminalSnapshot>()
  // Safety-net hard cap. The expected cleanup is the server-exit
  // event (handleExit), with removeSession / destroy as secondary
  // sites; a small ceiling trims the oldest entries if bookkeeping
  // ever drifts (e.g. a wedged server that never emits exit). Set
  // well above the realistic number of simultaneously-detached
  // sessions, so in normal use no entry is evicted by the trim path.
  private static readonly REATTACH_SNAPSHOT_CACHE_HARD_CAP = 32
  private readonly reattachSnapshotCache = new Map<string, ReattachSnapshotCacheEntry>()
  private readonly worktreeSnapshotCache = new Map<string, WorktreeTerminalSnapshot>()
  private readonly worktreeListeners = new Map<string, Set<() => void>>()
  private readonly snapshotListeners = new Map<string, Set<() => void>>()
  private readonly displayOrderByKey = new Map<string, number>()
  private readonly bellController = createTerminalBellController(
    (key) => {
      if (key) {
        const terminalWorktreeKey = this.sessions.get(key)?.descriptor.worktreeTerminalKey
        if (terminalWorktreeKey) this.notifyWorktree(terminalWorktreeKey)
        return
      }
      this.notifyAllWorktrees()
    },
    (count) => terminalBridge.setBadge(count),
  )

  constructor(
    private readonly getCurrentRepoId: () => string | null,
    private readonly onSelectedWorktreeChange: (worktreeTerminalKey: string, key: string | null) => void = () => {},
  ) {}

  setRepoIndex(repoIndex: TerminalRepoIndex): void {
    this.repoIndex = repoIndex
    this.syncDescriptorsFromRepoIndex()
  }

  setParkingRoot(root: HTMLDivElement | null): void {
    this.parkingRoot = root
  }

  destroy(): void {
    setTerminalFocused(false)
    for (const pending of this.pendingCreateByWorktree.values())
      pending.reject(new Error('terminal registry destroyed'))
    for (const session of this.sessions.values()) session.dispose({ closeSession: false })
    this.sessions.clear()
    this.sessionKeyBySessionId.clear()
    this.sessionIdByKey.clear()
    this.selectedKeyByWorktree.clear()
    this.preferredSelectedKeyByWorktree.clear()
    this.hostByWorktree.clear()
    this.geometryByWorktree.clear()
    this.pendingCreateByWorktree.clear()
    this.snapshotCache.clear()
    this.reattachSnapshotCache.clear()
    this.worktreeSnapshotCache.clear()
    this.worktreeListeners.clear()
    this.snapshotListeners.clear()
    this.bellController.reset()
  }

  handleOutput(event: { sessionId: string; data: string; seq: number; processName: string }): void {
    const directKey = this.sessionKeyBySessionId.get(event.sessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleOutput(event)
    }
  }

  handleServerTitle(event: { sessionId: string; canonicalTitle: string | null }): void {
    const directKey = this.sessionKeyBySessionId.get(event.sessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleServerTitle(event.canonicalTitle)
    }
  }

  handleExit(event: { sessionId: string }): void {
    const directKey = this.sessionKeyBySessionId.get(event.sessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directKey && directSession?.handleExit(event)) {
      // Local runtime accepted the exit — the reattach cache entry
      // for this key is now stale. Gating the delete on the runtime's
      // accept (rather than evicting eagerly on the sessionId match)
      // avoids discarding a still-valid cache entry during a race
      // where the local session has moved to a new sessionId (e.g.
      // after a server-side restart) but the index still maps the old
      // sessionId to the same key.
      this.reattachSnapshotCache.delete(directKey)
      this.discardLocalSessionAndDismissDetailIfLast(directKey, directSession.descriptor)
      return
    }
    if (directKey && directSession && !directSession.currentSessionId()) {
      // The runtime is empty (exit was observed earlier, or the
      // session was never attached) but the sessionId index still
      // points at it. The cache entry is keyed by the local key, not
      // the old sessionId, so leaving it in place is the right call —
      // the next reattach may still hydrate from it.
      this.discardLocalSessionAndDismissDetailIfLast(directKey, directSession.descriptor)
    }
  }

  handleOwnership(event: {
    sessionId: string
    role: 'controller' | 'viewer' | 'unowned'
    controllerStatus: 'connected' | 'grace' | 'none'
    canonicalCols: number
    canonicalRows: number
  }): void {
    const directKey = this.sessionKeyBySessionId.get(event.sessionId)
    const directSession = directKey ? this.sessions.get(directKey) : null
    if (directSession) {
      directSession.handleOwnership(event)
    }
  }

  reconcileServerSessions(
    repoRoot: string,
    serverSessions: ServerTerminalSessionSummary[],
    attachmentId: string,
    snapshotsBySessionId: ReadonlyMap<string, TerminalSessionSnapshot>,
  ): void {
    if (!this.repoIndex[repoRoot]) return

    const localKeysBefore = Array.from(this.sessions.entries())
      .filter(([, session]) => session.descriptor.repoRoot === repoRoot)
      .map(([key]) => key)

    const { controllerKeyByWorktree, touchedWorktrees, displayOrderChangedWorktrees, missingLocalCount } =
      this.materializeServerSessions(repoRoot, serverSessions, attachmentId, snapshotsBySessionId)

    const serverKeys = new Set(serverSessions.map((s) => s.key))
    const orphanedLocalCount = this.evictOrphanedLocalSessions(repoRoot, serverKeys)

    this.resolveSelectedKeysForTouchedWorktrees(touchedWorktrees, controllerKeyByWorktree)
    for (const worktreeTerminalKey of displayOrderChangedWorktrees) {
      this.notifyWorktree(worktreeTerminalKey)
    }
  }

  // Phase 1: for each server session, ensure a local ManagedTerminalSession
  // exists, hydrate it with the latest server-side metadata, and track
  // which worktrees saw any change. Side effects: ensureSession,
  // session.hydrate, displayOrderByKey, syncSessionIdIndex.
  private materializeServerSessions(
    repoRoot: string,
    serverSessions: ServerTerminalSessionSummary[],
    attachmentId: string,
    snapshotsBySessionId: ReadonlyMap<string, TerminalSessionSnapshot>,
  ): {
    controllerKeyByWorktree: Map<string, string>
    touchedWorktrees: Set<string>
    displayOrderChangedWorktrees: Set<string>
    missingLocalCount: number
  } {
    const controllerKeyByWorktree = new Map<string, string>()
    const touchedWorktrees = new Set<string>()
    const displayOrderChangedWorktrees = new Set<string>()
    let missingLocalCount = 0

    for (const serverSession of serverSessions) {
      const projected = projectServerTerminalSession({
        repoIndex: this.repoIndex,
        repoRoot,
        serverSession,
        attachmentId,
        serverSnapshot: snapshotsBySessionId.get(serverSession.sessionId) ?? null,
        reattachSnapshot: this.reattachSnapshotCache.get(serverSession.key) ?? null,
      })
      if (!projected) continue
      touchedWorktrees.add(projected.worktreeTerminalKey)
      const { descriptor } = projected
      if (!this.sessions.has(descriptor.key)) {
        missingLocalCount += 1
        this.ensureSession(descriptor)
      }
      this.sessions.get(descriptor.key)?.hydrate(projected.hydrateInput)
      this.syncSessionIdIndex(descriptor.key, projected.hydrateInput.sessionId)
      if (projected.controlsAttachment) controllerKeyByWorktree.set(projected.worktreeTerminalKey, descriptor.key)
      const previousDisplayOrder = this.displayOrderByKey.get(descriptor.key)
      this.displayOrderByKey.set(descriptor.key, projected.displayOrder)
      if (previousDisplayOrder !== undefined && previousDisplayOrder !== projected.displayOrder) {
        displayOrderChangedWorktrees.add(projected.worktreeTerminalKey)
      }
    }

    return { controllerKeyByWorktree, touchedWorktrees, displayOrderChangedWorktrees, missingLocalCount }
  }

  // Phase 2: drop local sessions that have a serverId but no longer
  // appear on the server. Only sessions that have ever been attached
  // (i.e. have a sessionId in our index) are eligible for eviction;
  // never-attached local shells (purely UI placeholders) are left
  // alone. Returns the count for the debug log.
  private evictOrphanedLocalSessions(repoRoot: string, serverKeys: Set<string>): number {
    const orphanedKeys = countOrphanedTerminalSessionKeys({
      repoRoot,
      localSessionKeys: Array.from(this.sessions.keys()),
      getRepoRootForKey: (key) => this.sessions.get(key)?.descriptor.repoRoot ?? null,
      hasServerSessionId: (key) => this.sessionIdByKey.has(key),
      serverKeys,
    })
    for (const key of orphanedKeys) {
      const session = this.sessions.get(key)
      if (!session) continue
      this.discardLocalSessionAndDismissDetailIfLast(key, session.descriptor)
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
      const current = this.selectedKeyByWorktree.get(worktreeKey) ?? null
      const preferred = this.preferredSelectedKeyByWorktree.get(worktreeKey) ?? null
      const next = resolveSelectedTerminalKey({
        worktreeTerminalKey: worktreeKey,
        preferredKey: preferred,
        currentKey: current,
        controllerKey: controllerKeyByWorktree.get(worktreeKey) ?? null,
        sortedDescriptors: this.sortedSessionsForWorktree(worktreeKey).map((session) => session.descriptor),
        isSelectedKeyValid: (candidateWorktreeKey, key) => this.isSelectedKeyValid(candidateWorktreeKey, key),
      })
      this.selectTerminalKey(worktreeKey, next)
    }
  }

  createTerminal = async (base: TerminalSessionBase): Promise<string> => {
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    const geometry = await this.resolveCreateGeometry(terminalWorktreeKey)
    if (!geometry) return await this.enqueuePendingCreate(base, terminalWorktreeKey)
    return await this.performCreateTerminal(base, geometry)
  }

  registerHost = (worktreeTerminalKey: string, host: HTMLElement): void => {
    this.hostByWorktree.set(worktreeTerminalKey, host)
    void captureTerminalHostGeometry({
      worktreeTerminalKey,
      hostByWorktree: this.hostByWorktree,
      geometryByWorktree: this.geometryByWorktree,
    })
    void this.flushPendingCreate(worktreeTerminalKey)
  }

  unregisterHost = (worktreeTerminalKey: string, host: HTMLElement): void => {
    if (this.hostByWorktree.get(worktreeTerminalKey) !== host) return
    this.hostByWorktree.delete(worktreeTerminalKey)
  }

  private async performCreateTerminal(
    base: TerminalSessionBase,
    geometry: { cols: number; rows: number },
  ): Promise<string> {
    const attachmentId = readOrCreateWebTerminalAttachmentId()
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    const result = await terminalBridge.create({
      repoRoot: base.repoRoot,
      branch: base.branch,
      worktreePath: base.worktreePath,
      kind: this.sortedSessionsForWorktree(terminalWorktreeKey).length === 0 ? 'primary' : 'additional',
      cols: geometry.cols,
      rows: geometry.rows,
      attachmentId,
    })
    if (!result.ok) {
      throw new Error(result.message)
    }
    if (!result.sessions.some((session) => session.key === result.key)) {
      throw new Error('error.terminal-create-failed')
    }
    this.setPreferredSelectedTerminalKey(terminalWorktreeKey, result.key)
    this.reconcileServerSessions(
      base.repoRoot,
      result.sessions,
      attachmentId,
      new Map<string, TerminalSessionSnapshot>(),
    )
    return result.key
  }

  private async resolveCreateGeometry(worktreeTerminalKey: string): Promise<{ cols: number; rows: number } | null> {
    return await resolveTerminalCreateGeometry({
      worktreeTerminalKey,
      hostByWorktree: this.hostByWorktree,
      geometryByWorktree: this.geometryByWorktree,
      selectedDescriptor: this.selectedDescriptor(worktreeTerminalKey),
      getAttachmentSnapshot: (key) => this.snapshot(key).attachment,
    })
  }

  private enqueuePendingCreate(base: TerminalSessionBase, worktreeTerminalKey: string): Promise<string> {
    const existing = this.pendingCreateByWorktree.get(worktreeTerminalKey)
    if (existing) return existing.promise
    let resolve!: (key: string) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    this.pendingCreateByWorktree.set(worktreeTerminalKey, { base, promise, resolve, reject })
    this.notifyWorktree(worktreeTerminalKey)
    void this.flushPendingCreate(worktreeTerminalKey)
    return promise
  }

  private async flushPendingCreate(worktreeTerminalKey: string): Promise<void> {
    const pending = this.pendingCreateByWorktree.get(worktreeTerminalKey)
    if (!pending) return
    const geometry = await this.resolveCreateGeometry(worktreeTerminalKey)
    if (!geometry) return
    this.pendingCreateByWorktree.delete(worktreeTerminalKey)
    this.notifyWorktree(worktreeTerminalKey)
    try {
      pending.resolve(await this.performCreateTerminal(pending.base, geometry))
    } catch (error) {
      pending.reject(error)
    }
  }

  private selectedDescriptor(worktreeTerminalKey: string): TerminalDescriptor | null {
    const selectedKey = this.selectedKeyByWorktree.get(worktreeTerminalKey)
    return selectedKey ? (this.sessions.get(selectedKey)?.descriptor ?? null) : null
  }

  setPreferredSelectedTerminalKeys(selectedKeysByWorktree: Record<string, string>): void {
    const nextPreferred = new Map(Object.entries(selectedKeysByWorktree))
    const worktrees = new Set<string>([
      ...Array.from(this.preferredSelectedKeyByWorktree.keys()),
      ...Array.from(nextPreferred.keys()),
      ...Array.from(this.selectedKeyByWorktree.keys()),
    ])
    this.preferredSelectedKeyByWorktree.clear()
    for (const [worktreeTerminalKey, key] of nextPreferred)
      this.preferredSelectedKeyByWorktree.set(worktreeTerminalKey, key)
    for (const worktreeTerminalKey of worktrees) {
      const preferred = this.preferredSelectedKeyByWorktree.get(worktreeTerminalKey) ?? null
      if (!preferred || !this.isSelectedKeyValid(worktreeTerminalKey, preferred)) continue
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
      sessions: this.sortedSessionsForWorktree(worktreeTerminalKey),
      selectedKey: this.selectedKeyByWorktree.get(worktreeTerminalKey) ?? null,
      getCachedSnapshot: (key) => this.snapshotCache.get(key) ?? null,
      cacheSnapshot: (key, nextSnapshot) => this.snapshotCache.set(key, nextSnapshot),
      hasBell: (key) => this.bellController.hasBell(key),
    })
    this.worktreeSnapshotCache.set(worktreeTerminalKey, snapshot)
    return snapshot
  }

  subscribeWorktree = (worktreeTerminalKey: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.worktreeListeners, worktreeTerminalKey, listener)
  }

  selectTerminal = (worktreeTerminalKey: string, key: string): void => {
    const session = this.sessions.get(key)
    if (!session || session.descriptor.worktreeTerminalKey !== worktreeTerminalKey) return
    const wasSelected = this.selectedKeyByWorktree.get(worktreeTerminalKey) === key
    const hadBell = this.bellController.hasBell(key)
    if (wasSelected && !hadBell) return
    this.selectTerminalKey(worktreeTerminalKey, key, { notify: !hadBell })
    this.bellController.clear(key)
  }

  clearBell = (key: string): boolean => {
    return this.bellController.clear(key)
  }

  scrollToBottom = (key: string): void => {
    this.sessions.get(key)?.scrollToBottom()
  }

  scrollLines = (key: string, amount: number): void => {
    this.sessions.get(key)?.scrollLines(amount)
  }

  closeTerminalByDescriptor = (key: string, base: TerminalSessionBase): void => {
    const session = this.sessions.get(key)
    if (!session || session.descriptor.worktreeTerminalKey !== worktreeTerminalKey(base.repoRoot, base.worktreePath))
      return
    this.closeTerminal(key)
  }

  attach = (descriptor: TerminalDescriptor, host: HTMLElement): void => {
    this.ensureSession(descriptor).attach(host)
  }

  detach = (key: string, host: HTMLElement): void => {
    const session = this.sessions.get(key)
    if (session && this.parkingRoot) {
      const serialized = session.serialize()
      const sessionId = session.currentSessionId()
      if (serialized && sessionId) {
        this.setReattachSnapshot(key, { sessionId, snapshot: serialized, snapshotSeq: 0 })
      }
      session.detach(host, this.parkingRoot)
    }
  }

  restart = (key: string): void => {
    this.sessions.get(key)?.restart()
  }

  snapshot = (key: string): TerminalSnapshot => {
    const cached = this.snapshotCache.get(key)
    if (cached) return cached
    const session = this.sessions.get(key)
    if (!session) return EMPTY_TERMINAL_SNAPSHOT
    const next = session.snapshot()
    this.snapshotCache.set(key, next)
    return next
  }

  isKnownSession = (key: string): boolean => {
    return this.sessions.has(key)
  }

  subscribeSnapshot = (key: string, listener: () => void): (() => void) => {
    return this.subscribeToKeyedListeners(this.snapshotListeners, key, listener)
  }

  isTerminalFocusTarget = (key: string, target: EventTarget | null): boolean => {
    return this.sessions.get(key)?.isTerminalFocusTarget(target) ?? false
  }

  findNext = (key: string, term: string, incremental?: boolean) => {
    return this.sessions.get(key)?.findNext(term, incremental) ?? { resultIndex: -1, resultCount: 0, found: false }
  }

  findPrevious = (key: string, term: string) => {
    return this.sessions.get(key)?.findPrevious(term) ?? { resultIndex: -1, resultCount: 0, found: false }
  }

  clearSearch = (key: string): void => {
    this.sessions.get(key)?.clearSearch()
  }

  writeInput = (key: string, data: string): void => {
    this.sessions.get(key)?.writeInput(data)
  }

  takeover = (key: string): void => {
    this.sessions.get(key)?.takeover()
  }

  serialize = (key: string): string => {
    return this.sessions.get(key)?.serialize() ?? ''
  }

  reorderSessions = async (scope: string, orderedKeys: string[]): Promise<boolean> => {
    if (orderedKeys.length === 0) return true
    if (new Set(orderedKeys).size !== orderedKeys.length) return false
    let parsed: { repoRoot: string; worktreePath: string; terminalId: string } | null = null
    for (const key of orderedKeys) {
      const item = parseServerSessionKey(key)
      if (!item) return false
      if (worktreeTerminalKey(item.repoRoot, item.worktreePath) !== scope) return false
      if (!parsed) parsed = item
    }
    if (!parsed) return false
    // Snapshot current order so we can roll back if the server rejects the reorder.
    const previousOrder = snapshotDisplayOrder(orderedKeys, this.displayOrderByKey)
    applyDisplayOrder(this.displayOrderByKey, orderedKeys)
    this.notifyWorktree(scope)
    const result = await terminalBridge.reorder({
      repoRoot: parsed.repoRoot,
      worktreePath: parsed.worktreePath,
      orderedKeys,
    })
    if (!result) {
      restoreDisplayOrder(this.displayOrderByKey, previousOrder)
      this.notifyWorktree(scope)
    }
    return result
  }

  private notifyWorktree(worktreeTerminalKey: string): void {
    this.worktreeSnapshotCache.delete(worktreeTerminalKey)
    const listeners = this.worktreeListeners.get(worktreeTerminalKey)
    if (!listeners) return
    for (const listener of Array.from(listeners)) listener()
  }

  private notifySnapshot(key: string): void {
    const listeners = this.snapshotListeners.get(key)
    if (!listeners) return
    for (const listener of Array.from(listeners)) listener()
  }

  private notifyAllWorktrees(): void {
    for (const worktreeTerminalKey of Array.from(this.worktreeListeners.keys()))
      this.notifyWorktree(worktreeTerminalKey)
  }

  private subscribeToKeyedListeners(
    listenersMap: Map<string, Set<() => void>>,
    key: string,
    listener: () => void,
  ): () => void {
    let listeners = listenersMap.get(key)
    if (!listeners) {
      listeners = new Set()
      listenersMap.set(key, listeners)
    }
    listeners.add(listener)
    return () => {
      const current = listenersMap.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) listenersMap.delete(key)
    }
  }

  private syncSessionIdIndex(key: string, sessionId: string | null): void {
    syncTerminalSessionIdIndex({
      key,
      sessionId,
      sessionIdByKey: this.sessionIdByKey,
      sessionKeyBySessionId: this.sessionKeyBySessionId,
    })
  }

  private notifySession(key: string, reason: 'metadata' | 'outputSummary' = 'metadata'): void {
    const session = this.sessions.get(key)
    this.syncSessionIdIndex(key, session?.currentSessionId() ?? null)
    if (session) {
      this.snapshotCache.set(key, session.snapshot())
    } else {
      this.snapshotCache.delete(key)
    }
    this.notifySnapshot(key)
    if (reason !== 'outputSummary') {
      const worktreeTerminalKey = session?.descriptor.worktreeTerminalKey
      if (worktreeTerminalKey) this.notifyWorktree(worktreeTerminalKey)
    }
  }

  // Cache write for the reattach path. The expected cleanup is the
  // server-exit event (handleExit), with removeSession / destroy as
  // secondary sites. A small hard cap trims the oldest entries if
  // bookkeeping ever drifts (e.g., a wedged server that never emits
  // exit); the limit is set well above the realistic number of
  // simultaneously-detached sessions.
  private setReattachSnapshot(key: string, entry: ReattachSnapshotCacheEntry): void {
    if (this.reattachSnapshotCache.has(key)) this.reattachSnapshotCache.delete(key)
    this.reattachSnapshotCache.set(key, entry)
    while (this.reattachSnapshotCache.size > TerminalSessionRegistry.REATTACH_SNAPSHOT_CACHE_HARD_CAP) {
      const oldestKey = this.reattachSnapshotCache.keys().next().value
      if (oldestKey === undefined) break
      this.reattachSnapshotCache.delete(oldestKey)
    }
  }

  private removeSession(key: string, options: { dispose: boolean; closeSession?: boolean }): boolean {
    const session = this.sessions.get(key)
    if (!session) return false
    const worktreeTerminalKey = session.descriptor.worktreeTerminalKey
    const orderedKeysBeforeRemoval = this.sortedSessionsForWorktree(worktreeTerminalKey).map(
      (item) => item.descriptor.key,
    )
    const wasSelected = this.selectedKeyByWorktree.get(worktreeTerminalKey) === key
    this.syncSessionIdIndex(key, null)
    this.sessions.delete(key)
    this.snapshotCache.delete(key)
    this.reattachSnapshotCache.delete(key)
    this.displayOrderByKey.delete(key)
    this.notifySnapshot(key)
    this.bellController.remove(key)
    if (options.dispose) session.dispose({ closeSession: options.closeSession !== false })
    if (wasSelected) {
      const nextKey = resolveAdjacentTerminalSelectionAfterRemoval(orderedKeysBeforeRemoval, key)
      this.selectTerminalKey(worktreeTerminalKey, nextKey, { notify: false })
    }
    this.notifyWorktree(worktreeTerminalKey)
    return true
  }

  private closeTerminal(key: string): void {
    this.removeSession(key, { dispose: true, closeSession: true })
  }

  private discardLocalSessionAndDismissDetailIfLast(key: string, base: TerminalSessionBase): void {
    const session = this.sessions.get(key)
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    if (!session || session.descriptor.worktreeTerminalKey !== terminalWorktreeKey) return
    this.removeSession(key, { dispose: true, closeSession: false })
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

  private ensureSession(descriptor: TerminalDescriptor): ManagedTerminalSession {
    const current = this.sessions.get(descriptor.key)
    if (current) {
      current.updateDescriptor(descriptor)
      this.syncSessionIdIndex(
        descriptor.key,
        current.currentSessionId() ?? this.sessionIdByKey.get(descriptor.key) ?? null,
      )
      this.notifyWorktree(descriptor.worktreeTerminalKey)
      return current
    }
    const session = new ManagedTerminalSession(
      descriptor,
      (reason) => this.notifySession(descriptor.key, reason),
      this.bellController.handleBell,
    )
    this.sessions.set(descriptor.key, session)
    this.syncSessionIdIndex(descriptor.key, session.currentSessionId())
    this.snapshotCache.set(descriptor.key, session.snapshot())
    if (!this.selectedKeyByWorktree.has(descriptor.worktreeTerminalKey)) {
      const preferred = this.preferredSelectedKeyByWorktree.get(descriptor.worktreeTerminalKey)
      if (!preferred || preferred === descriptor.key)
        this.selectTerminalKey(descriptor.worktreeTerminalKey, descriptor.key, { notify: false })
    }
    this.notifyWorktree(descriptor.worktreeTerminalKey)
    return session
  }

  private selectTerminalKey(worktreeTerminalKey: string, key: string | null, options: { notify?: boolean } = {}): void {
    const next = key && this.isSelectedKeyValid(worktreeTerminalKey, key) ? key : null
    const current = this.selectedKeyByWorktree.get(worktreeTerminalKey) ?? null
    if (current === next) {
      this.setPreferredSelectedTerminalKey(worktreeTerminalKey, next)
      return
    }
    if (next) {
      this.selectedKeyByWorktree.set(worktreeTerminalKey, next)
    } else {
      this.selectedKeyByWorktree.delete(worktreeTerminalKey)
    }
    this.setPreferredSelectedTerminalKey(worktreeTerminalKey, next)
    if (options.notify !== false) this.notifyWorktree(worktreeTerminalKey)
  }

  private setPreferredSelectedTerminalKey(worktreeTerminalKey: string, key: string | null): void {
    const current = this.preferredSelectedKeyByWorktree.get(worktreeTerminalKey) ?? null
    if (current === key) return
    if (key) this.preferredSelectedKeyByWorktree.set(worktreeTerminalKey, key)
    else this.preferredSelectedKeyByWorktree.delete(worktreeTerminalKey)
    this.onSelectedWorktreeChange(worktreeTerminalKey, key)
  }

  private isSelectedKeyValid(worktreeTerminalKey: string, key: string): boolean {
    return this.sessions.get(key)?.descriptor.worktreeTerminalKey === worktreeTerminalKey
  }

  private sortedSessionsForWorktree(worktreeTerminalKey: string): ManagedTerminalSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => session.descriptor.worktreeTerminalKey === worktreeTerminalKey)
      .sort((a, b) => {
        const orderA = terminalSessionDisplayOrder(a.descriptor, this.displayOrderByKey)
        const orderB = terminalSessionDisplayOrder(b.descriptor, this.displayOrderByKey)
        return orderA - orderB || a.descriptor.index - b.descriptor.index
      })
  }
}
