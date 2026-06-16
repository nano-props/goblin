import type { TerminalAttachResult, TerminalOutputEvent, TerminalSessionPhase } from '#/shared/terminal-types.ts'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'
import type { TerminalOwnershipViewModel, TerminalSearchResult } from '#/web/components/terminal/types.ts'
export class TerminalSessionRuntime {
  private readonly state = new TerminalSessionState()
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

  currentSessionId(): string | null {
    return this.ptySessionId
  }

  restartingSessionId(): string | null {
    return this.replacingPtySessionId ?? this.ptySessionId
  }

  currentCanonicalSize(): { cols: number; rows: number } {
    return this.state.getCanonicalSize()
  }

  canResize(): boolean {
    return this.state.getCanResize()
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
      role: TerminalOwnershipViewModel['role']
      controllerStatus: TerminalOwnershipViewModel['controllerStatus']
    },
    fallbackSize: { cols: number; rows: number },
  ): boolean {
    this.replacingPtySessionId = null
    this.ptySessionId = result.sessionId
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
    sessionId: string
    phase: TerminalSessionPhase
    message: string | null
    processName: string
    canonicalTitle?: string | null
    role: TerminalOwnershipViewModel['role']
    controllerStatus: TerminalOwnershipViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
  }): boolean {
    const sessionChanged = this.ptySessionId !== input.sessionId
    this.replacingPtySessionId = null
    this.restartOnStart = false
    this.ptySessionId = input.sessionId
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

  handleOutput(event: TerminalOutputEvent): { changed: boolean; output: string | null; summaryChanged: boolean } {
    if (event.sessionId !== this.ptySessionId) return { changed: false, output: null, summaryChanged: false }
    const changed = this.state.setProcessName(event.processName)
    if (this.state.captureReplayOutput(event)) return { changed, output: null, summaryChanged: false }
    const summaryChanged = this.state.getCanResize() ? false : this.state.appendOutputSummary(event.data)
    return { changed, output: event.data, summaryChanged }
  }

  handleOwnership(event: TerminalOwnershipViewModel): boolean {
    if (event.sessionId !== this.ptySessionId) return false
    return this.state.applyOwnership(event)
  }

  setCanonicalTitle(canonicalTitle: string | null): boolean {
    return this.state.setCanonicalTitle(canonicalTitle)
  }

  handleExit(event: { sessionId: string }): boolean {
    if (event.sessionId !== this.ptySessionId) return false
    this.ptySessionId = null
    return true
  }

  beginReplay(replaySeq: number): void {
    this.state.beginReplay(replaySeq)
  }

  finishReplay(): TerminalOutputEvent[] {
    const events = this.state.finishReplay()
    // The output summary is read only by the viewer overlay (gated on
    // !canResize). In controller mode it would never be read, so skip
    // the per-event string work.
    if (this.state.getCanResize()) return events
    for (const event of events) this.state.appendOutputSummary(event.data)
    return events
  }

  // Discards the replay buffer (boundary + captured events) without
  // queueing anything to the term or appending to the output
  // summary. Used by error / cancellation paths in
  // `ManagedTerminalSession` to clear replay state when the attach
  // fails partway through. The success path does not call this — the
  // preload's beginReplay and the post-attach's beginReplay share the
  // same window, and the post-attach's `finishReplay` drains the
  // combined buffer with the new boundary.
  drainReplay(): void {
    this.state.discardReplay()
  }

  acknowledgeResize(cols: number, rows: number): void {
    this.state.setCanonicalSize(cols, rows)
  }

  disposeSessionIds(): string[] {
    const sessionIds = new Set([this.ptySessionId, this.replacingPtySessionId].filter((id): id is string => !!id))
    this.ptySessionId = null
    this.replacingPtySessionId = null
    this.restartOnStart = false
    return Array.from(sessionIds)
  }

  closeReplacingSessionId(): string | null {
    const sessionId = this.replacingPtySessionId
    this.replacingPtySessionId = null
    return sessionId
  }
}
