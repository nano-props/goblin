import type { TerminalOutputEvent, TerminalSessionPhase } from '#/shared/terminal-types.ts'
import type {
  TerminalProgressState,
  TerminalSearchResult,
  TerminalSnapshot,
  TerminalControllerViewModel,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
} from '#/web/components/terminal/types.ts'
export class TerminalSessionState {
  /** Terminal runtime metadata mirrored from attach/session/identity events.
   *  This is authoritative runtime shape for the client, but it is not
   *  the same thing as workspace/session persistence. */
  private runtimeState: {
    phase: TerminalSessionPhase
    message: string | null
    processName: string
    canonicalTitle: string | null
    clientController: TerminalControllerViewModel
    identityRevision: number
    canonicalSize: { cols: number; rows: number } | null
  } = {
    phase: 'opening',
    message: null,
    processName: 'terminal',
    canonicalTitle: null,
    clientController: {
      role: 'controller',
      controllerStatus: 'connected',
    },
    identityRevision: -1,
    canonicalSize: null,
  }
  /** Client-only replay buffering used to merge output around
   *  attaches/replays. This is transient buffering, not server runtime
   *  identity and not persisted workspace state. */
  private outputSequencingState: {
    replayBoundary: TerminalOutputCheckpoint | null
    replayPendingOutput: TerminalOutputEvent[]
    replayGeneration: number
  } = {
    replayBoundary: null,
    replayPendingOutput: [],
    replayGeneration: 0,
  }
  /** Client-only terminal UI state such as search/progress. Progress comes
   *  from the browser xterm ProgressAddon parsing OSC 9;4 in raw output; the
   *  server scanner intentionally does not emit progress metadata events. This
   *  state is safe to discard when the active terminal view is torn down. */
  private transientViewState: {
    searchResult: TerminalSearchResult | null
    progressState: TerminalProgressState | null
  } = {
    searchResult: null,
    progressState: null,
  }

  getPhase(): TerminalSessionPhase {
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
  // never make this return false for a session whose role is still
  // `'controller'`. Named after the role enum value (not the
  // older "user" terminology) to match the userId/clientId/
  // terminalRuntimeSessionId identity split: the role is `controller`, not
  // `user`.
  isController(): boolean {
    return this.runtimeState.clientController.role === 'controller'
  }

  // Write-path predicate. Use this only at the actual input gate
  // — never as a stand-in for "is the controller". A session that is
  // 'controller' but still in `'opening'` cannot accept writes
  // (the PTY is still starting up) but is still the controller;
  // the teardown decision uses `isController()` and the write
  // decision uses this method. The two are intentionally separate.
  canSendInput(): boolean {
    return this.runtimeState.clientController.role === 'controller' && this.runtimeState.phase === 'open'
  }

  getClientController(): TerminalControllerViewModel {
    return this.runtimeState.clientController
  }

  getCanonicalSize(): { cols: number; rows: number } | null {
    return this.runtimeState.canonicalSize
  }

  snapshot(terminalRuntimeSessionId: string | null): TerminalSnapshot {
    const snapshot: TerminalSnapshot = {
      phase: this.runtimeState.phase,
      message: this.runtimeState.message,
      processName: this.runtimeState.processName,
      canonicalTitle: this.runtimeState.canonicalTitle,
    }
    // Control identity is orthogonal to lifecycle. In particular, a failed
    // restart keeps its retained generation addressable so its controller can
    // retry; hiding attachment identity in `error` would turn that controller
    // into a viewer only in the UI.
    if (terminalRuntimeSessionId) {
      snapshot.attachment = { role: this.runtimeState.clientController.role }
    }
    if (this.transientViewState.searchResult) snapshot.search = this.transientViewState.searchResult
    if (this.transientViewState.progressState) snapshot.progress = this.transientViewState.progressState
    return snapshot
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
    phase?: TerminalSessionPhase
    message?: string | null
    processName: string
    canonicalTitle?: string | null
    identityRevision: number
    role: TerminalControllerViewModel['role']
    controllerStatus: TerminalControllerViewModel['controllerStatus']
    canonicalSize: { cols: number; rows: number } | null
  }): boolean {
    let changed = this.establishIdentity(input)
    changed = this.applyRuntimeMetadata(input) || changed
    return changed
  }

  establishIdentity(input: TerminalIdentityStateInput): boolean {
    assertValidIdentityRevision(input.identityRevision)
    this.runtimeState.identityRevision = input.identityRevision
    return this.applyIdentityFields(input)
  }

  applyIdentity(event: TerminalIdentityStateInput): { accepted: boolean; changed: boolean } {
    assertValidIdentityRevision(event.identityRevision)
    if (event.identityRevision < this.runtimeState.identityRevision) return { accepted: false, changed: false }
    if (event.identityRevision === this.runtimeState.identityRevision) {
      if (!this.identityFieldsMatch(event)) {
        throw new Error('terminal identity payload conflicts at the same revision')
      }
      return { accepted: true, changed: false }
    }
    this.runtimeState.identityRevision = event.identityRevision
    return { accepted: true, changed: this.applyIdentityFields(event) }
  }

  applyRuntimeMetadata(input: {
    phase?: TerminalSessionPhase
    message?: string | null
    processName: string
    canonicalTitle?: string | null
  }): boolean {
    let changed = this.setPhaseAndMessage(input.phase ?? 'open', input.message ?? null)
    changed = this.setProcessName(input.processName) || changed
    changed = this.setCanonicalTitle(input.canonicalTitle ?? null) || changed
    return changed
  }

  applyLifecycle(event: TerminalLifecycleViewModel): boolean {
    return this.setPhaseAndMessage(event.phase, event.message)
  }

  setCanonicalSize(next: { cols: number; rows: number } | null): boolean {
    const current = this.runtimeState.canonicalSize
    if (current === null && next === null) return false
    if (current !== null && next !== null && current.cols === next.cols && current.rows === next.rows) return false
    this.runtimeState.canonicalSize = next
    return true
  }

  private setClientController(
    role: TerminalControllerViewModel['role'],
    controllerStatus: TerminalControllerViewModel['controllerStatus'],
  ): boolean {
    if (
      this.runtimeState.clientController.role === role &&
      this.runtimeState.clientController.controllerStatus === controllerStatus
    ) {
      return false
    }
    this.runtimeState.clientController = { role, controllerStatus }
    return true
  }

  private applyIdentityFields(input: TerminalIdentityStateInput): boolean {
    let changed = this.setClientController(input.role, input.controllerStatus)
    changed = this.setCanonicalSize(input.canonicalSize) || changed
    return changed
  }

  private identityFieldsMatch(input: TerminalIdentityStateInput): boolean {
    const currentController = this.runtimeState.clientController
    return (
      currentController.role === input.role &&
      currentController.controllerStatus === input.controllerStatus &&
      sameCanonicalSize(this.runtimeState.canonicalSize, input.canonicalSize)
    )
  }

  // Updates the replay boundary. Pending output is preserved when a newer
  // recovery snapshot supersedes an in-flight replay; the newest checkpoint
  // filters the shared buffer and the outer render queue still fences by
  // runtime binding.
  beginReplay(replayBoundary: TerminalOutputCheckpoint): number {
    this.outputSequencingState.replayBoundary = normalizeOutputCheckpoint(replayBoundary)
    this.outputSequencingState.replayGeneration += 1
    return this.outputSequencingState.replayGeneration
  }

  captureReplayOutput(event: TerminalOutputEvent): boolean {
    if (this.outputSequencingState.replayBoundary === null) return false
    this.outputSequencingState.replayPendingOutput.push(event)
    return true
  }

  finishReplay(replayGeneration?: number): TerminalOutputEvent[] {
    if (replayGeneration !== undefined && this.outputSequencingState.replayGeneration !== replayGeneration) {
      return []
    }
    const replayBoundary = this.outputSequencingState.replayBoundary
    const pendingOutput = this.outputSequencingState.replayPendingOutput.splice(0)
    this.outputSequencingState.replayBoundary = null
    if (replayBoundary === null) return []
    return pendingOutput.filter((event) => isOutputAfterCheckpoint(event, replayBoundary))
  }

  // Clears the replay buffer and boundary without queueing to the
  // term or appending to the output summary. Cheaper than
  // `finishReplay` because it skips the splice + filter.
  discardReplay(replayGeneration?: number): void {
    if (replayGeneration !== undefined && this.outputSequencingState.replayGeneration !== replayGeneration) {
      return
    }
    this.outputSequencingState.replayBoundary = null
    this.outputSequencingState.replayPendingOutput = []
  }

  resetTransientState(): boolean {
    const hadReplay =
      this.outputSequencingState.replayBoundary !== null || this.outputSequencingState.replayPendingOutput.length > 0
    const hadSearch = this.transientViewState.searchResult !== null
    const hadProgress = this.transientViewState.progressState !== null
    const changed = hadReplay || hadSearch || hadProgress
    this.outputSequencingState.replayBoundary = null
    this.outputSequencingState.replayPendingOutput = []
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

  private setPhaseAndMessage(phase: TerminalSessionPhase, message: string | null): boolean {
    if (this.runtimeState.phase === phase && this.runtimeState.message === message) return false
    this.runtimeState.phase = phase
    this.runtimeState.message = message
    return true
  }
}

interface TerminalIdentityStateInput extends TerminalControllerViewModel {
  identityRevision: number
  canonicalSize: { cols: number; rows: number } | null
}

function assertValidIdentityRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid terminal identity revision')
}

function sameCanonicalSize(
  a: { cols: number; rows: number } | null,
  b: { cols: number; rows: number } | null,
): boolean {
  if (!a || !b) return a === b
  return a.cols === b.cols && a.rows === b.rows
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

export interface TerminalOutputCheckpoint {
  seq: number
}

function normalizeOutputCheckpoint(checkpoint: TerminalOutputCheckpoint): TerminalOutputCheckpoint {
  return {
    seq: normalizeOutputSeq(checkpoint.seq),
  }
}

function isOutputAfterCheckpoint(event: TerminalOutputEvent, checkpoint: TerminalOutputCheckpoint): boolean {
  return event.seq > checkpoint.seq
}

function normalizeOutputSeq(seq: number): number {
  if (!Number.isFinite(seq)) return 0
  return Math.max(0, Math.floor(seq))
}
