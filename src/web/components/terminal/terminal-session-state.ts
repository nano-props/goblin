import type { TerminalOutputEvent } from '#/shared/terminal.ts'
import {
  createTerminalAttachmentSnapshot,
} from '#/web/components/terminal/types.ts'
import type {
  TerminalPhase,
  TerminalProgressState,
  TerminalSearchResult,
  TerminalSnapshot,
  TerminalAttachmentOwnershipViewModel,
  TerminalOwnershipViewModel,
} from '#/web/components/terminal/types.ts'
export class TerminalSessionState {
  /** Terminal runtime metadata mirrored from attach/session/ownership events.
   *  This is authoritative runtime shape for the renderer, but it is not
   *  the same thing as workspace/session persistence. */
  private runtimeState: {
    phase: TerminalPhase
    message: string | null
    processName: string
    canonicalTitle: string | null
    attachmentOwnership: TerminalAttachmentOwnershipViewModel
    canonicalSize: { cols: number; rows: number }
  } = {
    phase: 'opening',
    message: null,
    processName: 'terminal',
    canonicalTitle: null,
    attachmentOwnership: {
      role: 'controller',
      controllerStatus: 'connected',
    },
    canonicalSize: { cols: 0, rows: 0 },
  }
  /** Renderer-only replay bookkeeping used to merge buffered output around
   *  attaches/replays. This is transient buffering, not server runtime
   *  identity and not persisted workspace state. */
  private replayBufferState: {
    replayBoundarySeq: number | null
    replayPendingOutput: TerminalOutputEvent[]
  } = {
    replayBoundarySeq: null,
    replayPendingOutput: [],
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

  getCanResize(): boolean {
    return this.runtimeState.attachmentOwnership.role === 'controller'
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
    if (this.runtimeState.phase === 'open' && ptySessionId) {
      snapshot.attachment = createTerminalAttachmentSnapshot({
        ...this.runtimeState.attachmentOwnership,
        canonicalCols: this.runtimeState.canonicalSize.cols,
        canonicalRows: this.runtimeState.canonicalSize.rows,
      })
    }
    if (this.transientViewState.searchResult) snapshot.search = this.transientViewState.searchResult
    if (this.transientViewState.progressState) snapshot.progress = this.transientViewState.progressState
    return snapshot
  }

  setOpening(): boolean {
    return this.setPhaseAndMessage('opening', null)
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
    processName: string
    canonicalTitle?: string | null
    role: TerminalAttachmentOwnershipViewModel['role']
    controllerStatus: TerminalAttachmentOwnershipViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
  }): boolean {
    let changed = false
    changed = this.setProcessName(input.processName) || changed
    changed = this.setCanonicalTitle(input.canonicalTitle ?? null) || changed
    if (
      this.runtimeState.attachmentOwnership.role !== input.role ||
      this.runtimeState.attachmentOwnership.controllerStatus !== input.controllerStatus
    ) {
      this.runtimeState.attachmentOwnership = { role: input.role, controllerStatus: input.controllerStatus }
      changed = true
    }
    changed = this.setCanonicalSize(input.canonicalCols, input.canonicalRows) || changed
    return changed
  }

  applyOwnership(event: TerminalOwnershipViewModel): boolean {
    let changed = false
    if (
      this.runtimeState.attachmentOwnership.role !== event.role ||
      this.runtimeState.attachmentOwnership.controllerStatus !== event.controllerStatus
    ) {
      this.runtimeState.attachmentOwnership = { role: event.role, controllerStatus: event.controllerStatus }
      changed = true
    }
    changed = this.setCanonicalSize(event.canonicalCols, event.canonicalRows) || changed
    return changed
  }

  setCanonicalSize(cols: number, rows: number): boolean {
    if (this.runtimeState.canonicalSize.cols === cols && this.runtimeState.canonicalSize.rows === rows) return false
    this.runtimeState.canonicalSize = { cols, rows }
    return true
  }

  beginReplay(replaySeq: number): void {
    this.replayBufferState.replayBoundarySeq = replaySeq
    this.replayBufferState.replayPendingOutput = []
  }

  captureReplayOutput(event: TerminalOutputEvent): boolean {
    if (this.replayBufferState.replayBoundarySeq === null) return false
    this.replayBufferState.replayPendingOutput.push(event)
    return true
  }

  finishReplay(): TerminalOutputEvent[] {
    const replaySeq = this.replayBufferState.replayBoundarySeq
    const pendingOutput = this.replayBufferState.replayPendingOutput.splice(0)
    this.replayBufferState.replayBoundarySeq = null
    if (replaySeq === null) return []
    return pendingOutput.filter((event) => event.seq > replaySeq)
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
