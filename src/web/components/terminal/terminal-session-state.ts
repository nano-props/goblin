import type { TerminalOutputEvent } from '#/shared/terminal-types.ts'
import { stripTerminalControlSequences } from '#/web/components/terminal/terminal-output-text.ts'
import { createTerminalAttachmentSnapshot } from '#/web/components/terminal/types.ts'
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
    takeoverPending: boolean
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
    takeoverPending: false,
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
  /** Viewer-mode output summary: last N characters of stripped terminal output. */
  private outputSummary = ''
  private outputSummaryLines: string[] = []
  private readonly MAX_OUTPUT_SUMMARY_CHARS = 500
  private readonly MAX_OUTPUT_SUMMARY_LINES = 1000

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
    return this.runtimeState.phase === 'open' && this.runtimeState.attachmentOwnership.role === 'controller'
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
    if (this.runtimeState.takeoverPending) snapshot.takeoverPending = true
    const summary = this.outputSummary.trimEnd()
    if (summary) snapshot.outputSummary = summary
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
    role: TerminalAttachmentOwnershipViewModel['role']
    controllerStatus: TerminalAttachmentOwnershipViewModel['controllerStatus']
    canonicalCols: number
    canonicalRows: number
  }): boolean {
    let changed = false
    changed = this.setPhaseAndMessage(input.phase ?? 'open', input.message ?? null) || changed
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
    const hadSummary = this.outputSummary.length > 0
    const changed = hadReplay || hadSearch || hadProgress || hadSummary
    this.replayBufferState.replayBoundarySeq = null
    this.replayBufferState.replayPendingOutput = []
    this.transientViewState.searchResult = null
    this.transientViewState.progressState = null
    this.outputSummary = ''
    this.outputSummaryLines = []
    return changed
  }

  getOutputSummary(): string | null {
    const trimmed = this.outputSummary.trimEnd()
    return trimmed.length > 0 ? trimmed : null
  }

  appendOutputSummary(data: string): boolean {
    const stripped = stripTerminalControlSequences(data)
    if (!stripped) return false

    const incomingLines = stripped.split(/\r\n|\r|\n/)
    for (const line of incomingLines) {
      if (line.trim().length === 0) continue
      this.outputSummaryLines.push(line.trimEnd())
    }
    if (this.outputSummaryLines.length > this.MAX_OUTPUT_SUMMARY_LINES) {
      this.outputSummaryLines = this.outputSummaryLines.slice(-this.MAX_OUTPUT_SUMMARY_LINES)
    }

    const collapsed: string[] = []
    for (const line of this.outputSummaryLines) {
      if (collapsed.length === 0) {
        collapsed.push(line)
        continue
      }
      const last = collapsed[collapsed.length - 1]
      const match = /^(.+) \[x(\d+)\]$/.exec(last)
      const base = match ? match[1] : last
      const count = match ? parseInt(match[2], 10) : 1
      if (line === base) {
        collapsed[collapsed.length - 1] = `${base} [x${count + 1}]`
      } else {
        collapsed.push(line)
      }
    }

    const tail = collapsed.slice(-20)
    let result = tail.join('\n')
    if (result.length > this.MAX_OUTPUT_SUMMARY_CHARS) {
      result = result.slice(-this.MAX_OUTPUT_SUMMARY_CHARS)
      const firstNl = result.indexOf('\n')
      if (firstNl >= 0) {
        result = result.slice(firstNl + 1)
      }
    }
    this.outputSummary = result
    return true
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
