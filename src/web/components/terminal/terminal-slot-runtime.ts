import type {
  TerminalAttachResult,
  TerminalClientRole,
  TerminalOutputEvent,
  TerminalSlotPhase,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { TerminalSlotState } from '#/web/components/terminal/terminal-slot-state.ts'
import type {
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'
export class TerminalSlotRuntime {
  private readonly state = new TerminalSlotState()
  private ptySessionId: string | null = null
  private replacingPtySessionId: string | null = null
  private restartOnStart = false

  snapshot() {
    return this.state.snapshot(this.ptySessionId)
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

  currentPtySessionId(): string | null {
    return this.ptySessionId
  }

  restartingPtySessionId(): string | null {
    return this.replacingPtySessionId ?? this.ptySessionId
  }

  currentCanonicalSize(): { cols: number; rows: number } {
    return this.state.getCanonicalSize()
  }

  // Role-only predicate: is this client the active controller of
  // the PTY? The teardown decision in
  // `ManagedTerminalSlot.handleIdentity` must use this — never
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
    const oldPtySessionId = this.ptySessionId
    this.ptySessionId = null
    if (oldPtySessionId) this.replacingPtySessionId = oldPtySessionId
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
    this.replacingPtySessionId = null
    this.ptySessionId = result.ptySessionId
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

  hydrateSession(input: {
    ptySessionId: string
    phase: TerminalSlotPhase
    message: string | null
    processName: string
    canonicalTitle?: string | null
    role: TerminalIdentityViewModel['role']
    controllerStatus: TerminalIdentityViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
  }): boolean {
    const sessionChanged = this.ptySessionId !== input.ptySessionId
    this.replacingPtySessionId = null
    this.restartOnStart = false
    this.ptySessionId = input.ptySessionId
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

  markAttached(): boolean {
    return this.state.setOpen()
  }

  failAttachAttempt(message: string): boolean {
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
    if (event.ptySessionId !== this.ptySessionId) return { changed: false, output: null }
    const changed = this.state.setProcessName(event.processName)
    if (this.state.captureReplayOutput(event)) return { changed, output: null }
    return { changed, output: event.data }
  }

  handleIdentity(event: TerminalIdentityViewModel): boolean {
    if (event.ptySessionId !== this.ptySessionId) return false
    return this.state.applyIdentity(event)
  }

  handleLifecycle(event: TerminalLifecycleViewModel): boolean {
    if (event.ptySessionId !== this.ptySessionId) return false
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
   * caller must already have a current ptySessionId for the takeover
   * to be valid; this is a defensive guard).
   */
  applyTakeover(result: Extract<TerminalTakeoverResult, { ok: true }>): boolean {
    if (result.ptySessionId !== this.ptySessionId) return false
    const idChanged = this.state.applyIdentity({
      ptySessionId: result.ptySessionId,
      role: result.role,
      controllerStatus: result.controllerStatus,
      canonicalCols: result.canonicalCols,
      canonicalRows: result.canonicalRows,
    })
    const lcChanged = this.state.applyLifecycle({
      ptySessionId: result.ptySessionId,
      phase: result.phase,
      message: null,
      takeoverPending: false,
    })
    return idChanged || lcChanged
  }

  setCanonicalTitle(canonicalTitle: string | null): boolean {
    return this.state.setCanonicalTitle(canonicalTitle)
  }

  handleExit(event: { ptySessionId: string }): boolean {
    if (event.ptySessionId !== this.ptySessionId) return false
    this.ptySessionId = null
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

  disposePtySessionIds(): string[] {
    const ptySessionIds = new Set([this.ptySessionId, this.replacingPtySessionId].filter((id): id is string => !!id))
    this.ptySessionId = null
    this.replacingPtySessionId = null
    this.restartOnStart = false
    return Array.from(ptySessionIds)
  }

  closeReplacingPtySessionId(): string | null {
    const ptySessionId = this.replacingPtySessionId
    this.replacingPtySessionId = null
    return ptySessionId
  }
}
