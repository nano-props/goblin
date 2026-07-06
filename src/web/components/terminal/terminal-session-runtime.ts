import type {
  TerminalAttachResult,
  TerminalClientRole,
  TerminalOutputEvent,
  TerminalSessionPhase,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'
import type {
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'
export class TerminalSessionRuntime {
  private readonly state = new TerminalSessionState()
  private terminalRuntimeSessionId: string | null = null
  // Restart is issued against the last server runtime session id. During
  // the restart attempt the client has no open attachment, but the server
  // session remains addressable; if restart fails, this id is restored and
  // the session enters `error` instead of being closed.
  private pendingRestartTerminalRuntimeSessionId: string | null = null
  private restartOnStart = false

  snapshot() {
    return this.state.snapshot(this.terminalRuntimeSessionId)
  }

  phase(): 'opening' | 'restarting' | 'open' | 'error' | 'closed' {
    return this.state.getPhase()
  }

  processName(): string {
    return this.state.getProcessName()
  }

  canonicalTitle(): string | null {
    return this.state.getCanonicalTitle()
  }

  currentTerminalRuntimeSessionId(): string | null {
    return this.terminalRuntimeSessionId
  }

  restartingTerminalRuntimeSessionId(): string | null {
    return this.pendingRestartTerminalRuntimeSessionId ?? this.terminalRuntimeSessionId
  }

  currentCanonicalSize(): { cols: number; rows: number } {
    return this.state.getCanonicalSize()
  }

  // Role-only predicate: is this client the active controller of
  // the PTY? The teardown decision in
  // `TerminalSession.handleIdentity` must use this — never
  // `canSendInput` — so a transitional phase update cannot be
  // misread as a controller→viewer transition.
  isController(): boolean {
    return this.state.isController()
  }

  // Write-path predicate. Used at the actual input gate; never
  // as a stand-in for "is the controller".
  canSendInput(): boolean {
    return this.state.canSendInput()
  }

  clientRole(): TerminalClientRole {
    return this.state.getClientController().role
  }

  startAttaching(): boolean {
    return this.state.setOpening()
  }

  consumeRestartFlag(): boolean {
    return this.restartOnStart
  }

  prepareRestart(): { changed: boolean } {
    const oldTerminalRuntimeSessionId = this.terminalRuntimeSessionId
    this.terminalRuntimeSessionId = null
    if (oldTerminalRuntimeSessionId) this.pendingRestartTerminalRuntimeSessionId = oldTerminalRuntimeSessionId
    this.restartOnStart = true
    return { changed: this.state.setRestarting() }
  }

  settleStartAttempt(): void {
    this.restartOnStart = false
  }

  applyAttachResult(
    result: Extract<TerminalAttachResult, { ok: true }> & {
      role: TerminalIdentityViewModel['role']
      controllerStatus: TerminalIdentityViewModel['controllerStatus']
    },
    fallbackSize: { cols: number; rows: number },
  ): boolean {
    this.pendingRestartTerminalRuntimeSessionId = null
    this.terminalRuntimeSessionId = result.terminalRuntimeSessionId
    this.state.setLastAppliedOutputSeq(result.snapshotSeq)
    return this.state.applyOpenResult({
      phase: result.phase,
      message: result.message,
      processName: result.processName,
      canonicalTitle: result.canonicalTitle ?? null,
      role: result.role,
      controllerStatus: result.controllerStatus,
      canonicalCols: result.canonicalCols ?? fallbackSize.cols,
      canonicalRows: result.canonicalRows ?? fallbackSize.rows,
    })
  }

  hydrateRepoSession(input: {
    terminalRuntimeSessionId: string
    phase: TerminalSessionPhase
    message: string | null
    processName: string
    canonicalTitle?: string | null
    role: TerminalIdentityViewModel['role']
    controllerStatus: TerminalIdentityViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
    snapshotSeq?: number
  }): boolean {
    const sessionChanged = this.terminalRuntimeSessionId !== input.terminalRuntimeSessionId
    this.pendingRestartTerminalRuntimeSessionId = null
    this.restartOnStart = false
    this.terminalRuntimeSessionId = input.terminalRuntimeSessionId
    const snapshotSeq = input.snapshotSeq ?? (sessionChanged ? 0 : undefined)
    if (snapshotSeq !== undefined) this.state.setLastAppliedOutputSeq(snapshotSeq)
    const metadataChanged = this.state.applyOpenResult({
      phase: input.phase,
      message: input.message,
      processName: input.processName,
      canonicalTitle: input.canonicalTitle ?? null,
      role: input.role,
      controllerStatus: input.controllerStatus,
      canonicalCols: input.canonicalCols,
      canonicalRows: input.canonicalRows,
    })
    const stateChanged = metadataChanged
    return sessionChanged || stateChanged
  }

  failAttachAttempt(message: string): boolean {
    return this.state.setError(message)
  }

  failRestartAttempt(message: string): boolean {
    if (this.pendingRestartTerminalRuntimeSessionId) {
      this.terminalRuntimeSessionId = this.pendingRestartTerminalRuntimeSessionId
      this.pendingRestartTerminalRuntimeSessionId = null
    }
    this.restartOnStart = false
    return this.state.setError(message)
  }

  failRuntime(message: string): boolean {
    return this.state.setError(message)
  }

  setSearchResult(result: TerminalSearchResult | null): boolean {
    return this.state.setSearchResult(result)
  }

  currentSearchResult(): TerminalSearchResult | null {
    return this.state.getSearchResult()
  }

  setProgress(state: number, value: number): boolean {
    return this.state.setProgress(state, value)
  }

  setTakeoverPending(value: boolean): boolean {
    return this.state.setTakeoverPending(value)
  }

  clearTakeoverPending(): boolean {
    return this.state.clearTakeoverPending()
  }

  isTakeoverPending(): boolean {
    return this.state.isTakeoverPending()
  }

  resetTransientState(): boolean {
    return this.state.resetTransientState()
  }

  handleOutput(event: TerminalOutputEvent): { changed: boolean; output: string | null } {
    if (event.terminalRuntimeSessionId !== this.terminalRuntimeSessionId) return { changed: false, output: null }
    if (this.state.isOutputAlreadyApplied(event)) return { changed: false, output: null }
    const changed = this.state.setProcessName(event.processName)
    if (this.state.captureReplayOutput(event)) return { changed, output: null }
    this.state.advanceLastAppliedOutputSeq(event.seq)
    return { changed, output: event.data }
  }

  handleIdentity(event: TerminalIdentityViewModel): boolean {
    if (event.terminalRuntimeSessionId !== this.terminalRuntimeSessionId) return false
    return this.state.applyIdentity(event)
  }

  handleLifecycle(event: TerminalLifecycleViewModel): boolean {
    if (event.terminalRuntimeSessionId !== this.terminalRuntimeSessionId) return false
    return this.state.applyLifecycle(event)
  }

  /**
   * Authoritative handshake for the takeover path. The takeover
   * response carries identity (role + canonicalCols/Rows) and
   * lifecycle (phase + message) in a single payload — both
   * `applyIdentity` and `applyLifecycle` are idempotent, so the
   * later realtime `identity` event for the same session is a
   * no-op.
   *
   * Returns `false` if the result is for a different session (the
   * caller must already have a current terminalRuntimeSessionId for the takeover
   * to be valid; this is a defensive guard).
   */
  applyTakeover(result: Extract<TerminalTakeoverResult, { ok: true }>): boolean {
    if (result.terminalRuntimeSessionId !== this.terminalRuntimeSessionId) return false
    const idChanged = this.state.applyIdentity({
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      role: result.role,
      controllerStatus: result.controllerStatus,
      canonicalCols: result.canonicalCols,
      canonicalRows: result.canonicalRows,
    })
    const lcChanged = this.state.applyLifecycle({
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      phase: result.phase,
      message: null,
      takeoverPending: false,
    })
    return idChanged || lcChanged
  }

  setCanonicalTitle(canonicalTitle: string | null): boolean {
    return this.state.setCanonicalTitle(canonicalTitle)
  }

  handleExit(event: { terminalRuntimeSessionId: string }): boolean {
    if (event.terminalRuntimeSessionId !== this.terminalRuntimeSessionId) return false
    this.terminalRuntimeSessionId = null
    return true
  }

  beginReplay(replaySeq: number): number {
    return this.state.beginReplay(replaySeq)
  }

  finishReplay(replayGeneration?: number): TerminalOutputEvent[] {
    return this.state.finishReplay(replayGeneration)
  }

  isReplaying(): boolean {
    return this.state.isReplaying()
  }

  // Drops the replay buffer for the error / cancellation paths. The
  // success path uses `finishReplay` instead, which appends to the
  // summary under the new role.
  drainReplay(replayGeneration?: number): void {
    this.state.discardReplay(replayGeneration)
  }

  acknowledgeResize(cols: number, rows: number): void {
    this.state.setCanonicalSize(cols, rows)
  }

  terminalRuntimeSessionIdsForClose(): string[] {
    return Array.from(
      new Set(
        [this.terminalRuntimeSessionId, this.pendingRestartTerminalRuntimeSessionId].filter((id): id is string => !!id),
      ),
    )
  }

  disposeTerminalRuntimeSessionIds(): string[] {
    const terminalRuntimeSessionIds = this.terminalRuntimeSessionIdsForClose()
    this.terminalRuntimeSessionId = null
    this.pendingRestartTerminalRuntimeSessionId = null
    this.restartOnStart = false
    return terminalRuntimeSessionIds
  }

  takePendingRestartTerminalRuntimeSessionIdForClose(): string | null {
    const terminalRuntimeSessionId = this.pendingRestartTerminalRuntimeSessionId
    this.pendingRestartTerminalRuntimeSessionId = null
    return terminalRuntimeSessionId
  }
}
