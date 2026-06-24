import type { TerminalOutputEvent } from '#/shared/terminal-types.ts'
import { createTerminalClientSnapshot } from '#/web/components/terminal/types.ts'
import type {
  TerminalPhase,
  TerminalProgressState,
  TerminalSearchResult,
  TerminalSnapshot,
  TerminalControllerViewModel,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
} from '#/web/components/terminal/types.ts'
export class TerminalSlotState {
  /** Terminal runtime metadata mirrored from attach/session/identity events.
   *  This is authoritative runtime shape for the renderer, but it is not
   *  the same thing as workspace/session persistence. */
  private runtimeState: {
    phase: TerminalPhase
    message: string | null
    processName: string
    canonicalTitle: string | null
    clientController: TerminalControllerViewModel
    canonicalSize: { cols: number; rows: number }
    takeoverPending: boolean
  } = {
    phase: 'opening',
    message: null,
    processName: 'terminal',
    canonicalTitle: null,
    clientController: {
      role: 'controller',
      controllerStatus: 'connected',
    },
    canonicalSize: { cols: 0, rows: 0 },
    takeoverPending: false,
  }
  /** Renderer-only replay bookkeeping used to merge buffered output around
   *  attaches/replays. This is transient buffering, not server runtime
   *  identity and not persisted workspace state. */
  private replayBufferState: {
    replayBoundarySeq: number | null
    replayPendingOutput: TerminalOutputEvent[]
    replayGeneration: number
  } = {
    replayBoundarySeq: null,
    replayPendingOutput: [],
    replayGeneration: 0,
  }
  /** Renderer-only terminal UI state such as search/progress. This is safe
   *  to discard when the active terminal view is torn down. */
  private transientViewState: {
    searchResult: TerminalSearchResult | null
    progressState: TerminalProgressState | null
  } = {
    searchResult: null,
    progressState: null,
  }

  getPhase(): TerminalPhase {
    return this.runtimeState.phase
  }

  getProcessName(): string {
    return this.runtimeState.processName
  }

  getCanonicalTitle(): string | null {
    return this.runtimeState.canonicalTitle
  }

  getSearchResult(): TerminalSearchResult | null {
    return this.transientViewState.searchResult
  }

  // **Role-only** predicate: is this client the active `controller`
  // of the PTY? Use this for any decision that should track the
  // controller role alone — teardown on role change, render-time
  // role banner, focus, etc. A transitional phase update must
  // never make this return false for a slot whose role is still
  // `'controller'`. Named after the role enum value (not the
  // older "user" terminology) to match the userId/clientId/
  // ptySessionId identity split: the role is `controller`, not
  // `user`.
  isController(): boolean {
    return this.runtimeState.clientController.role === 'controller'
  }

  // Write-path predicate. Use this only at the actual input gate
  // — never as a stand-in for "is the controller". A slot that is
  // 'controller' but still in `'opening'` cannot accept writes
  // (the PTY is still starting up) but is still the controller;
  // the teardown decision uses `isController()` and the write
  // decision uses this method. The two are intentionally separate.
  canSendInput(): boolean {
    return this.runtimeState.clientController.role === 'controller' && this.runtimeState.phase === 'open'
  }

  getClientOwnership(): TerminalControllerViewModel {
    return this.runtimeState.clientController
  }

  getCanonicalSize(): { cols: number; rows: number } {
    return this.runtimeState.canonicalSize
  }

  snapshot(ptySessionId: string | null): TerminalSnapshot {
    const snapshot: TerminalSnapshot = {
      phase: this.runtimeState.phase,
      message: this.runtimeState.message,
      processName: this.runtimeState.processName,
      canonicalTitle: this.runtimeState.canonicalTitle,
    }
    // The `attachment` slot is only populated when the slot is
    // open AND we have a ptySessionId, matching the previous
    // behaviour. The fields are identity-only — phase is at the
    // top level of the snapshot already.
    if (this.runtimeState.phase === 'open' && ptySessionId) {
      snapshot.attachment = createTerminalClientSnapshot({
        ...this.runtimeState.clientController,
        canonicalCols: this.runtimeState.canonicalSize.cols,
        canonicalRows: this.runtimeState.canonicalSize.rows,
      })
    }
    if (this.transientViewState.searchResult) snapshot.search = this.transientViewState.searchResult
    if (this.transientViewState.progressState) snapshot.progress = this.transientViewState.progressState
    if (this.runtimeState.takeoverPending) snapshot.takeoverPending = true
    return snapshot
  }

  setOpening(): boolean {
    return this.setPhaseAndMessage('opening', null)
  }

  setRestarting(): boolean {
    return this.setPhaseAndMessage('restarting', null)
  }

  setOpen(): boolean {
    return this.setPhaseAndMessage('open', null)
  }

  setError(message: string | null): boolean {
    return this.setPhaseAndMessage('error', message)
  }

  setProcessName(processName: string): boolean {
    const next = processName.trim() || 'terminal'
    if (this.runtimeState.processName === next) return false
    this.runtimeState.processName = next
    return true
  }

  setCanonicalTitle(canonicalTitle: string | null): boolean {
    const next = normalizeTerminalTitle(canonicalTitle)
    if (this.runtimeState.canonicalTitle === next) return false
    this.runtimeState.canonicalTitle = next
    return true
  }

  applyOpenResult(input: {
    phase?: TerminalPhase
    message?: string | null
    processName: string
    canonicalTitle?: string | null
    role: TerminalControllerViewModel['role']
    controllerStatus: TerminalControllerViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
  }): boolean {
    // The first-frame payload carries both identity and lifecycle
    // in one shape. Apply them through their respective boundaries
    // so the `applyIdentity` / `applyLifecycle` separation is
    // preserved even on the synchronous create/attach/takeover
    // path. Identity first, then lifecycle — order is irrelevant
    // because they touch disjoint state.
    let changed = false
    changed =
      this.applyIdentity({
        ptySessionId: '', // The runtime stamps the actual ptySessionId itself; the first-frame path carries it via `currentPtySessionId` set by the caller.
        role: input.role,
        controllerStatus: input.controllerStatus,
        canonicalCols: input.canonicalCols,
        canonicalRows: input.canonicalRows,
      }) || changed
    changed =
      this.applyLifecycle({
        ptySessionId: '',
        phase: input.phase ?? 'open',
        message: input.message ?? null,
        takeoverPending: false,
      }) || changed
    changed = this.setProcessName(input.processName) || changed
    changed = this.setCanonicalTitle(input.canonicalTitle ?? null) || changed
    return changed
  }

  applyIdentity(event: TerminalIdentityViewModel): boolean {
    let changed = false
    if (
      this.runtimeState.clientController.role !== event.role ||
      this.runtimeState.clientController.controllerStatus !== event.controllerStatus
    ) {
      this.runtimeState.clientController = { role: event.role, controllerStatus: event.controllerStatus }
      changed = true
    }
    changed = this.setCanonicalSize(event.canonicalCols, event.canonicalRows) || changed
    return changed
  }

  applyLifecycle(event: TerminalLifecycleViewModel): boolean {
    let changed = false
    changed = this.setPhaseAndMessage(event.phase, event.message) || changed
    if (this.runtimeState.takeoverPending !== event.takeoverPending) {
      this.runtimeState.takeoverPending = event.takeoverPending
      changed = true
    }
    return changed
  }

  setCanonicalSize(cols: number, rows: number): boolean {
    if (this.runtimeState.canonicalSize.cols === cols && this.runtimeState.canonicalSize.rows === rows) return false
    this.runtimeState.canonicalSize = { cols, rows }
    return true
  }

  // Updates the replay boundary. The pending-output buffer is
  // preserved across calls, so a preload window (cached snapshot's
  // seq) followed by a post-attach window (new snapshot's seq)
  // shares the same buffer; the post-attach `finishReplay` filters
  // by the new boundary.
  beginReplay(replaySeq: number): number {
    this.replayBufferState.replayBoundarySeq = replaySeq
    this.replayBufferState.replayGeneration += 1
    return this.replayBufferState.replayGeneration
  }

  captureReplayOutput(event: TerminalOutputEvent): boolean {
    if (this.replayBufferState.replayBoundarySeq === null) return false
    this.replayBufferState.replayPendingOutput.push(event)
    return true
  }

  isReplaying(): boolean {
    return this.replayBufferState.replayBoundarySeq !== null
  }

  finishReplay(replayGeneration?: number): TerminalOutputEvent[] {
    if (
      replayGeneration !== undefined &&
      this.replayBufferState.replayGeneration !== replayGeneration
    ) {
      return []
    }
    const replaySeq = this.replayBufferState.replayBoundarySeq
    const pendingOutput = this.replayBufferState.replayPendingOutput.splice(0)
    this.replayBufferState.replayBoundarySeq = null
    if (replaySeq === null) return []
    return pendingOutput.filter((event) => event.seq > replaySeq)
  }

  // Clears the replay buffer and boundary without queueing to the
  // term or appending to the output summary. Cheaper than
  // `finishReplay` because it skips the splice + filter.
  discardReplay(replayGeneration?: number): void {
    if (
      replayGeneration !== undefined &&
      this.replayBufferState.replayGeneration !== replayGeneration
    ) {
      return
    }
    this.replayBufferState.replayBoundarySeq = null
    this.replayBufferState.replayPendingOutput = []
  }

  resetTransientState(): boolean {
    const hadReplay =
      this.replayBufferState.replayBoundarySeq !== null || this.replayBufferState.replayPendingOutput.length > 0
    const hadSearch = this.transientViewState.searchResult !== null
    const hadProgress = this.transientViewState.progressState !== null
    const changed = hadReplay || hadSearch || hadProgress
    this.replayBufferState.replayBoundarySeq = null
    this.replayBufferState.replayPendingOutput = []
    this.transientViewState.searchResult = null
    this.transientViewState.progressState = null
    return changed
  }

  setSearchResult(result: TerminalSearchResult | null): boolean {
    if (sameSearchResult(this.transientViewState.searchResult, result)) return false
    this.transientViewState.searchResult = result
    return true
  }

  setProgress(state: number, value: number): boolean {
    if (state === 0) {
      if (!this.transientViewState.progressState) return false
      this.transientViewState.progressState = null
      return true
    }
    const next = { state: state as TerminalProgressState['state'], value: Math.max(0, Math.min(100, value)) }
    if (sameProgressState(this.transientViewState.progressState, next)) return false
    this.transientViewState.progressState = next
    return true
  }

  setTakeoverPending(value: boolean): boolean {
    if (this.runtimeState.takeoverPending === value) return false
    this.runtimeState.takeoverPending = value
    return true
  }

  clearTakeoverPending(): boolean {
    return this.setTakeoverPending(false)
  }

  isTakeoverPending(): boolean {
    return this.runtimeState.takeoverPending
  }

  private setPhaseAndMessage(phase: TerminalPhase, message: string | null): boolean {
    if (this.runtimeState.phase === phase && this.runtimeState.message === message) return false
    this.runtimeState.phase = phase
    this.runtimeState.message = message
    return true
  }
}

function sameSearchResult(a: TerminalSearchResult | null, b: TerminalSearchResult | null): boolean {
  if (!a || !b) return a === b
  return a.resultIndex === b.resultIndex && a.resultCount === b.resultCount && a.found === b.found
}

function sameProgressState(a: TerminalProgressState | null, b: TerminalProgressState | null): boolean {
  if (!a || !b) return a === b
  return a.state === b.state && a.value === b.value
}

function normalizeTerminalTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') return null
  const normalized = title.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}
