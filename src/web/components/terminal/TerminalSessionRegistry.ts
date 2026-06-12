import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { ManagedTerminalSession } from '#/web/components/terminal/ManagedTerminalSession.ts'
import { createTerminalBellController } from '#/web/components/terminal/terminal-bell-controller.ts'
import { terminalDescriptor } from '#/web/components/terminal/terminal-descriptor.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { compactTerminalProcessName, compactTerminalTitle } from '#/web/components/terminal/terminal-title.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { readOrCreateWebTerminalAttachmentId } from '#/web/renderer-terminal-bridge.ts'
import { parseTerminalIdIndex, resolveTerminalOwnership } from '#/shared/terminal.ts'
import type {
  TerminalSessionSnapshot,
  TerminalSessionSummary as ServerTerminalSessionSummary,
} from '#/shared/terminal.ts'
import { branchForTerminalWorktree } from '#/web/components/terminal/terminal-repo-index.ts'
import type {
  TerminalDescriptor,
  TerminalRepoIndex,
  WorktreeTerminalSnapshot,
  TerminalSessionBase,
  TerminalSessionSummary,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'

const EMPTY_TERMINAL_SNAPSHOT: TerminalSnapshot = {
  phase: 'opening',
  message: null,
  processName: 'terminal',
  canonicalTitle: null,
}
function parseServerSessionKey(key: string): { repoRoot: string; worktreePath: string; terminalId: string } | null {
  const parts = key.split('\0')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  return { repoRoot: parts[0], worktreePath: parts[1], terminalId: parts[2] }
}

interface ReattachSnapshotCacheEntry {
  sessionId: string
  snapshot: string
  snapshotSeq: number
}

export class TerminalSessionRegistry {
  private repoIndex: TerminalRepoIndex = {}
  private parkingRoot: HTMLDivElement | null = null
  private readonly sessions = new Map<string, ManagedTerminalSession>()
  private readonly sessionKeyBySessionId = new Map<string, string>()
  private readonly sessionIdByKey = new Map<string, string>()
  private readonly selectedKeyByWorktree = new Map<string, string>()
  private readonly preferredSelectedKeyByWorktree = new Map<string, string>()
  private readonly snapshotCache = new Map<string, TerminalSnapshot>()
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
    private readonly onWorktreeEmpty: (repoRoot: string, worktreePath: string) => void = () => {},
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
    for (const session of this.sessions.values()) session.dispose({ closeSession: false })
    this.sessions.clear()
    this.sessionKeyBySessionId.clear()
    this.sessionIdByKey.clear()
    this.selectedKeyByWorktree.clear()
    this.preferredSelectedKeyByWorktree.clear()
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
      this.discardLocalSessionAndDismissDetailIfLast(directKey, directSession.descriptor)
      return
    }
    if (directKey && directSession && !directSession.currentSessionId()) {
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
    const serverSessionsByKey = new Map(serverSessions.map((session) => [session.key, session]))
    const controllerKeyByWorktree = new Map<string, string>()
    const touchedWorktrees = new Set<string>()
    const localKeys = Array.from(this.sessions.entries())
      .filter(([, session]) => session.descriptor.repoRoot === repoRoot)
      .map(([key]) => key)

    let missingLocalCount = 0
    let orphanedLocalCount = 0

    for (const serverSession of serverSessions) {
      const parsed = parseServerSessionKey(serverSession.key)
      if (!parsed || parsed.repoRoot !== repoRoot) continue
      const branch = branchForTerminalWorktree(this.repoIndex, parsed.repoRoot, parsed.worktreePath)
      if (!branch) continue
      const terminalWorktreeKey = worktreeTerminalKey(parsed.repoRoot, parsed.worktreePath)
      touchedWorktrees.add(terminalWorktreeKey)
      const descriptor = terminalDescriptor(
        { repoRoot: parsed.repoRoot, branch, worktreePath: parsed.worktreePath },
        parsed.terminalId,
        parseTerminalIdIndex(parsed.terminalId) ?? 1,
      )
      if (!this.sessions.has(descriptor.key)) {
        missingLocalCount += 1
        this.ensureSession(descriptor)
      }
      const reattachCache = this.reattachSnapshotCache.get(descriptor.key)
      const isReattachMatch = reattachCache?.sessionId === serverSession.sessionId
      const serverSnapshot = snapshotsBySessionId.get(serverSession.sessionId) ?? null
      const ownership = resolveTerminalOwnership(serverSession.controller, attachmentId)
      this.sessions.get(descriptor.key)?.hydrate({
        sessionId: serverSession.sessionId,
        processName: serverSession.processName,
        canonicalTitle: serverSession.canonicalTitle,
        role: ownership.role,
        controllerStatus: ownership.controllerStatus,
        canonicalCols: serverSession.cols,
        canonicalRows: serverSession.rows,
        snapshot: serverSnapshot?.snapshot ?? (isReattachMatch ? reattachCache?.snapshot : undefined),
        snapshotSeq: serverSnapshot?.snapshotSeq ?? (isReattachMatch ? reattachCache?.snapshotSeq : undefined),
      })
      this.syncSessionIdIndex(descriptor.key, serverSession.sessionId)
      if (serverSession.controller?.attachmentId === attachmentId) {
        controllerKeyByWorktree.set(terminalWorktreeKey, descriptor.key)
      }
      this.displayOrderByKey.set(descriptor.key, serverSession.displayOrder)
    }

    for (const key of localKeys) {
      const session = this.sessions.get(key)
      if (!session) continue
      if (serverSessionsByKey.has(key)) continue
      if (!this.sessionIdByKey.has(key)) continue
      orphanedLocalCount += 1
      this.discardLocalSessionAndDismissDetailIfLast(key, session.descriptor)
    }

    if (missingLocalCount > 0 || orphanedLocalCount > 0) {
      console.debug('[TerminalSessionProvider] sync results for', repoRoot, ':', {
        serverSessions: serverSessions.length,
        localSessions: localKeys.length,
        missingLocal: missingLocalCount,
        orphanedLocal: orphanedLocalCount,
      })
    }

    for (const worktreeTerminalKey of touchedWorktrees) {
      const current = this.selectedKeyByWorktree.get(worktreeTerminalKey) ?? null
      const preferred = this.preferredSelectedKeyByWorktree.get(worktreeTerminalKey) ?? null
      const next = this.resolveSelectedTerminalKey(
        worktreeTerminalKey,
        preferred,
        current,
        controllerKeyByWorktree.get(worktreeTerminalKey) ?? null,
      )
      this.selectTerminalKey(worktreeTerminalKey, next)
    }
  }

  createTerminal = async (base: TerminalSessionBase): Promise<string> => {
    const attachmentId = readOrCreateWebTerminalAttachmentId()
    const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
    const result = await terminalBridge.create({
      repoRoot: base.repoRoot,
      branch: base.branch,
      worktreePath: base.worktreePath,
      kind: this.sessionSummaries(terminalWorktreeKey).length === 0 ? 'primary' : 'additional',
      attachmentId,
    })
    if (!result.ok) {
      throw new Error(result.message)
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
    const sessions = this.sessionSummaries(worktreeTerminalKey)
    const snapshot: WorktreeTerminalSnapshot = {
      worktreeTerminalKey,
      selectedDescriptor: this.selectedDescriptor(worktreeTerminalKey),
      sessions,
      count: sessions.length,
    }
    this.worktreeSnapshotCache.set(worktreeTerminalKey, snapshot)
    return snapshot
  }

  private sessionSummaries(worktreeTerminalKey: string): TerminalSessionSummary[] {
    const selectedKey = this.selectedKeyByWorktree.get(worktreeTerminalKey) ?? null
    return this.sortedSessionsForWorktree(worktreeTerminalKey)
      .map((session) => {
        const snapshot = this.snapshotCache.get(session.descriptor.key) ?? session.snapshot()
        this.snapshotCache.set(session.descriptor.key, snapshot)
        return {
          key: session.descriptor.key,
          worktreeTerminalKey,
          terminalId: session.descriptor.terminalId,
          index: session.descriptor.index,
          title: summarizeTerminalTitle(snapshot, session.descriptor.index),
          fullTitle: fullTerminalTitle(snapshot, session.descriptor.index),
          originalTitle: terminalOriginalTitle(snapshot),
          phase: snapshot.phase,
          selected: session.descriptor.key === selectedKey,
          hasBell: this.bellController.hasBell(session.descriptor.key),
        }
      })
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

  closeTerminalAndDismissDetailIfLast = (key: string, base: TerminalSessionBase): void => {
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
        this.reattachSnapshotCache.set(key, { sessionId, snapshot: serialized, snapshotSeq: 0 })
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
    const previousOrder = new Map<string, number | undefined>()
    for (const key of orderedKeys) previousOrder.set(key, this.displayOrderByKey.get(key))
    for (let i = 0; i < orderedKeys.length; i++) {
      this.displayOrderByKey.set(orderedKeys[i], i)
    }
    this.notifyWorktree(scope)
    const result = await terminalBridge.reorder({
      repoRoot: parsed.repoRoot,
      worktreePath: parsed.worktreePath,
      orderedKeys,
    })
    if (!result) {
      for (const [key, order] of previousOrder) {
        if (order === undefined) this.displayOrderByKey.delete(key)
        else this.displayOrderByKey.set(key, order)
      }
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
    const previousSessionId = this.sessionIdByKey.get(key)
    if (
      previousSessionId &&
      previousSessionId !== sessionId &&
      this.sessionKeyBySessionId.get(previousSessionId) === key
    ) {
      this.sessionKeyBySessionId.delete(previousSessionId)
    }
    if (!sessionId) {
      this.sessionIdByKey.delete(key)
      return
    }
    this.sessionIdByKey.set(key, sessionId)
    this.sessionKeyBySessionId.set(sessionId, key)
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

  private removeSession(key: string, options: { dispose: boolean; closeSession?: boolean }): boolean {
    const session = this.sessions.get(key)
    if (!session) return false
    const worktreeTerminalKey = session.descriptor.worktreeTerminalKey
    const orderedKeysBeforeRemoval = this.sortedSessionsForWorktree(worktreeTerminalKey).map((item) => item.descriptor.key)
    const closedOrderIndex = orderedKeysBeforeRemoval.indexOf(key)
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
      const remaining = this.sortedSessionsForWorktree(worktreeTerminalKey)
      const right = closedOrderIndex >= 0 ? remaining[closedOrderIndex] : null
      const left = closedOrderIndex >= 1 ? remaining[closedOrderIndex - 1] : null
      const nextKey = right?.descriptor.key ?? left?.descriptor.key ?? null
      this.selectTerminalKey(worktreeTerminalKey, nextKey, { notify: false })
    }
    this.notifyWorktree(worktreeTerminalKey)
    if (!this.hasSessionsForWorktree(worktreeTerminalKey)) {
      this.onWorktreeEmpty(session.descriptor.repoRoot, session.descriptor.worktreePath)
    }
    return true
  }

  private hasSessionsForWorktree(worktreeTerminalKey: string): boolean {
    for (const s of this.sessions.values()) {
      if (s.descriptor.worktreeTerminalKey === worktreeTerminalKey) return true
    }
    return false
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
        const orderA = this.displayOrderByKey.get(a.descriptor.key) ?? a.descriptor.index - 1
        const orderB = this.displayOrderByKey.get(b.descriptor.key) ?? b.descriptor.index - 1
        return orderA - orderB || a.descriptor.index - b.descriptor.index
      })
  }

  private resolveSelectedTerminalKey(
    worktreeTerminalKey: string,
    preferredKey: string | null,
    currentKey: string | null = this.selectedKeyByWorktree.get(worktreeTerminalKey) ?? null,
    controllerKey: string | null = null,
  ): string | null {
    if (preferredKey && this.isSelectedKeyValid(worktreeTerminalKey, preferredKey)) return preferredKey
    if (currentKey && this.isSelectedKeyValid(worktreeTerminalKey, currentKey)) return currentKey
    if (controllerKey && this.isSelectedKeyValid(worktreeTerminalKey, controllerKey)) return controllerKey
    return this.sortedSessionsForWorktree(worktreeTerminalKey)[0]?.descriptor.key ?? null
  }
}

function summarizeTerminalTitle(snapshot: TerminalSnapshot, index: number): string {
  const canonicalTitle = terminalOriginalTitle(snapshot) ?? ''
  if (canonicalTitle) return compactTerminalTitle(canonicalTitle) || canonicalTitle
  const processName = compactTerminalProcessName(snapshot.processName)
  return processName || `terminal ${index}`
}

function fullTerminalTitle(snapshot: TerminalSnapshot, index: number): string {
  const canonicalTitle = terminalOriginalTitle(snapshot) ?? ''
  return canonicalTitle || snapshot.processName || `terminal ${index}`
}

function terminalOriginalTitle(snapshot: TerminalSnapshot): string | null {
  const canonicalTitle = typeof snapshot.canonicalTitle === 'string' ? snapshot.canonicalTitle.trim() : ''
  return canonicalTitle || null
}
