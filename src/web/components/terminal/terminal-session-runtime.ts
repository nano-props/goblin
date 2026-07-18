import type {
  TerminalAttachResult,
  TerminalClientRole,
  TerminalOutputEvent,
  TerminalSessionPhase,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'
import type { TerminalOutputCheckpoint } from '#/web/components/terminal/terminal-session-state.ts'
import type {
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'

export interface TerminalRuntimeBinding {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}

type TerminalRuntimeAttachFrame =
  Extract<TerminalAttachResult, { ok: true }> extends infer TResult
    ? TResult extends { ok: true }
      ? Omit<TResult, 'terminalProjectionEffect'>
      : never
    : never

export type TerminalRuntimeBindingClassification = 'active' | 'retiring' | 'future' | 'foreign'

export interface TerminalRuntimeAttemptToken {
  attemptId: number
  operation: 'attach' | 'restart'
}

export interface TerminalRepoSessionHydration extends TerminalRuntimeBinding {
  phase: TerminalSessionPhase
  message: string | null
  processName: string
  canonicalTitle?: string | null
  role: TerminalIdentityViewModel['role']
  controllerStatus: TerminalIdentityViewModel['controllerStatus']
  canonicalCols: number
  canonicalRows: number
}

export type TerminalRuntimeHydrationResult =
  | { disposition: 'applied'; changed: boolean }
  | { disposition: 'ignored'; changed: false }
  | {
      disposition: 'staged'
      changed: false
      candidateAccepted: boolean
      activationPending: boolean
    }

export type TerminalAuthoritativeHydrationSource = 'snapshot' | 'partial-effect'

export type TerminalRuntimeAttemptResult = {
  accepted: boolean
  changed: boolean
  resolution: 'response' | 'staged' | 'error' | 'superseded'
}

type TerminalRuntimeBindingState =
  | { kind: 'unbound' }
  | { kind: 'active'; binding: TerminalRuntimeBinding }
  | {
      kind: 'transitioning'
      operation: 'attach' | 'restart'
      active: TerminalRuntimeBinding | null
      retiring: TerminalRuntimeBinding | null
      attemptId: number
    }
  | { kind: 'error'; addressableBinding: TerminalRuntimeBinding | null }
  | { kind: 'closing'; binding: TerminalRuntimeBinding | null }
  | { kind: 'closed'; lastBinding: TerminalRuntimeBinding | null }

export class TerminalSessionRuntime {
  private readonly state = new TerminalSessionState()
  private bindingState: TerminalRuntimeBindingState = { kind: 'unbound' }
  private nextAttemptId = 0
  private restartOnStart = false
  private stagedAuthoritativeHydration: TerminalRepoSessionHydration | null = null

  snapshot() {
    return this.state.snapshot(this.activeBinding()?.terminalRuntimeSessionId ?? null)
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
    return this.activeBinding()?.terminalRuntimeSessionId ?? null
  }

  currentTerminalRuntimeGeneration(): number | null {
    return this.activeBinding()?.terminalRuntimeGeneration ?? null
  }

  currentRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.activeBinding()
  }

  addressableRuntimeBinding(): TerminalRuntimeBinding | null {
    switch (this.bindingState.kind) {
      case 'active':
        return this.bindingState.binding
      case 'transitioning':
        return this.bindingState.active ?? this.bindingState.retiring
      case 'error':
        return this.bindingState.addressableBinding
      case 'closing':
        return this.bindingState.binding
      case 'closed':
        return this.bindingState.lastBinding
      case 'unbound':
        return null
    }
  }

  retiringRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.bindingState.kind === 'transitioning' ? this.bindingState.retiring : null
  }

  restartingTerminalRuntimeSessionId(): string | null {
    return this.addressableRuntimeBinding()?.terminalRuntimeSessionId ?? null
  }

  classifyRuntimeBinding(binding: TerminalRuntimeBinding): TerminalRuntimeBindingClassification {
    const active = this.activeBinding()
    if (active && sameBinding(active, binding)) return 'active'
    const retiring = this.retiringRuntimeBinding()
    if (retiring && sameBinding(retiring, binding)) return 'retiring'
    if (this.bindingState.kind === 'transitioning') {
      const known = active ?? retiring
      if (!known) return 'future'
      if (binding.terminalRuntimeSessionId !== known.terminalRuntimeSessionId) return 'future'
    }
    const known = active ?? retiring ?? this.addressableRuntimeBinding()
    if (!known) return this.bindingState.kind === 'closed' ? 'foreign' : 'future'
    if (
      binding.terminalRuntimeSessionId === known.terminalRuntimeSessionId &&
      binding.terminalRuntimeGeneration > known.terminalRuntimeGeneration
    ) {
      return 'future'
    }
    return 'foreign'
  }

  currentCanonicalSize(): { cols: number; rows: number } {
    return this.state.getCanonicalSize()
  }

  isController(): boolean {
    return this.state.isController()
  }

  canSendInput(): boolean {
    return this.activeBinding() !== null && this.state.canSendInput()
  }

  clientRole(): TerminalClientRole {
    return this.state.getClientController().role
  }

  startAttaching(): { changed: boolean; attempt: TerminalRuntimeAttemptToken } {
    const active = this.activeBinding()
    const attempt = { attemptId: ++this.nextAttemptId, operation: 'attach' as const }
    this.bindingState = {
      kind: 'transitioning',
      operation: 'attach',
      active,
      retiring: null,
      attemptId: attempt.attemptId,
    }
    return { changed: this.state.setOpening(), attempt }
  }

  consumeRestartFlag(): boolean {
    return this.restartOnStart
  }

  prepareRestart(): { changed: boolean; attempt: TerminalRuntimeAttemptToken } {
    const retiring = this.addressableRuntimeBinding()
    const attempt = { attemptId: ++this.nextAttemptId, operation: 'restart' as const }
    this.bindingState = {
      kind: 'transitioning',
      operation: 'restart',
      active: null,
      retiring,
      attemptId: attempt.attemptId,
    }
    this.restartOnStart = true
    return { changed: this.state.setRestarting(), attempt }
  }

  currentAttemptToken(): TerminalRuntimeAttemptToken | null {
    return this.bindingState.kind === 'transitioning'
      ? { attemptId: this.bindingState.attemptId, operation: this.bindingState.operation }
      : null
  }

  settleStartAttempt(attempt: TerminalRuntimeAttemptToken): boolean {
    if (!this.isCurrentAttempt(attempt)) return false
    this.restartOnStart = false
    return true
  }

  commitAttachResult(
    attempt: TerminalRuntimeAttemptToken,
    result: TerminalRuntimeAttachFrame & {
      role: TerminalIdentityViewModel['role']
      controllerStatus: TerminalIdentityViewModel['controllerStatus']
    },
    fallbackSize: { cols: number; rows: number },
  ): TerminalRuntimeAttemptResult {
    if (!this.isCurrentAttempt(attempt) || !this.isValidAttemptResultBinding(attempt, result)) {
      return { accepted: false, changed: false, resolution: 'superseded' }
    }
    const binding = bindingFrom(result)
    const staged = this.stagedAuthoritativeHydration
    if (staged && hydrationSupersedesResponse(staged, binding)) {
      return {
        accepted: true,
        changed: false,
        resolution: 'staged',
      }
    }
    this.stagedAuthoritativeHydration = null
    const previous = this.activeBinding()
    this.bindingState = { kind: 'active', binding }
    this.restartOnStart = false
    const metadataChanged = this.state.applyOpenResult({
      phase: result.phase,
      message: result.message,
      processName: result.processName,
      canonicalTitle: result.canonicalTitle ?? null,
      role: result.role,
      controllerStatus: result.controllerStatus,
      canonicalCols: result.canonicalCols ?? fallbackSize.cols,
      canonicalRows: result.canonicalRows ?? fallbackSize.rows,
    })
    return {
      accepted: true,
      changed: !previous || !sameBinding(previous, binding) || metadataChanged,
      resolution: 'response',
    }
  }

  hydrateRepoSession(
    input: TerminalRepoSessionHydration,
    source: TerminalAuthoritativeHydrationSource = 'snapshot',
  ): TerminalRuntimeHydrationResult {
    if (this.bindingState.kind === 'transitioning') {
      const candidateAccepted =
        source === 'snapshot' &&
        this.classifyRuntimeBinding(input) === 'future' &&
        this.stageAuthoritativeHydration(input)
      return {
        disposition: 'staged',
        changed: false,
        candidateAccepted,
        activationPending: candidateAccepted,
      }
    }
    this.stagedAuthoritativeHydration = null
    const active = this.activeBinding()
    if (source === 'partial-effect') {
      if (this.bindingState.kind !== 'unbound' && (!active || !sameBinding(active, input))) {
        return { disposition: 'ignored', changed: false }
      }
    } else if (
      active &&
      active.terminalRuntimeSessionId === input.terminalRuntimeSessionId &&
      input.terminalRuntimeGeneration < active.terminalRuntimeGeneration
    ) {
      return { disposition: 'ignored', changed: false }
    }
    return { disposition: 'applied', changed: this.applyRepoHydration(input) }
  }

  private applyRepoHydration(input: TerminalRepoSessionHydration): boolean {
    const binding = bindingFrom(input)
    const previous = this.activeBinding()
    this.bindingState = { kind: 'active', binding }
    this.restartOnStart = false
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
    return !previous || !sameBinding(previous, binding) || metadataChanged
  }

  private stageAuthoritativeHydration(input: TerminalRepoSessionHydration): boolean {
    const current = this.stagedAuthoritativeHydration
    if (
      current &&
      current.terminalRuntimeSessionId === input.terminalRuntimeSessionId &&
      current.terminalRuntimeGeneration > input.terminalRuntimeGeneration
    ) {
      return false
    }
    this.stagedAuthoritativeHydration = { ...input }
    return true
  }

  pendingAuthoritativeRuntimeBinding(): TerminalRuntimeBinding | null {
    const hydration = this.stagedAuthoritativeHydration
    if (!hydration || this.bindingState.kind !== 'transitioning') return null
    return this.classifyRuntimeBinding(hydration) === 'future' ? bindingFrom(hydration) : null
  }

  commitPendingAuthoritativeHydration(binding: TerminalRuntimeBinding): { accepted: boolean; changed: boolean } {
    const hydration = this.stagedAuthoritativeHydration
    if (
      !hydration ||
      this.bindingState.kind !== 'transitioning' ||
      !sameBinding(hydration, binding) ||
      this.classifyRuntimeBinding(hydration) !== 'future'
    ) {
      return { accepted: false, changed: false }
    }
    this.stagedAuthoritativeHydration = null
    return { accepted: true, changed: this.applyRepoHydration(hydration) }
  }

  failAttachAttempt(message: string): boolean {
    this.bindingState = { kind: 'error', addressableBinding: this.addressableRuntimeBinding() }
    return this.state.setError(message)
  }

  failStartAttempt(attempt: TerminalRuntimeAttemptToken, message: string): TerminalRuntimeAttemptResult {
    if (!this.isCurrentAttempt(attempt)) {
      return { accepted: false, changed: false, resolution: 'superseded' }
    }
    const staged = this.stagedAuthoritativeHydration
    if (staged) {
      this.restartOnStart = false
      return {
        accepted: true,
        changed: false,
        resolution: 'staged',
      }
    }
    const addressableBinding = this.addressableRuntimeBinding()
    this.bindingState = { kind: 'error', addressableBinding }
    this.restartOnStart = false
    return { accepted: true, changed: this.state.setError(message), resolution: 'error' }
  }

  failRestartAttempt(message: string): boolean {
    this.bindingState = { kind: 'error', addressableBinding: this.addressableRuntimeBinding() }
    this.restartOnStart = false
    return this.state.setError(message)
  }

  failRuntime(message: string): boolean {
    this.bindingState = { kind: 'error', addressableBinding: this.addressableRuntimeBinding() }
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
    if (this.classifyRuntimeBinding(event) !== 'active') return { changed: false, output: null }
    const changed = this.state.setProcessName(event.processName)
    if (this.state.captureReplayOutput(event)) return { changed, output: null }
    return { changed, output: event.data }
  }

  handleIdentity(event: TerminalIdentityViewModel): boolean {
    if (this.classifyRuntimeBinding(event) !== 'active') return false
    return this.state.applyIdentity(event)
  }

  handleLifecycle(event: TerminalLifecycleViewModel): boolean {
    if (this.classifyRuntimeBinding(event) !== 'active') return false
    return this.state.applyLifecycle(event)
  }

  applyTakeover(result: Extract<TerminalTakeoverResult, { ok: true }>): boolean {
    if (this.classifyRuntimeBinding(result) !== 'active') return false
    const idChanged = this.state.applyIdentity({
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      terminalRuntimeGeneration: result.terminalRuntimeGeneration,
      role: result.role,
      controllerStatus: result.controllerStatus,
      canonicalCols: result.canonicalCols,
      canonicalRows: result.canonicalRows,
    })
    const lifecycleChanged = this.state.applyLifecycle({
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      terminalRuntimeGeneration: result.terminalRuntimeGeneration,
      phase: result.phase,
      message: null,
      takeoverPending: false,
    })
    return idChanged || lifecycleChanged
  }

  setCanonicalTitle(canonicalTitle: string | null): boolean {
    return this.state.setCanonicalTitle(canonicalTitle)
  }

  handleExit(event: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number }): boolean {
    if (this.classifyRuntimeBinding(event) !== 'active') return false
    const binding = this.activeBinding()
    this.bindingState = { kind: 'closed', lastBinding: binding }
    return true
  }

  beginReplay(replayBoundary: TerminalOutputCheckpoint): number {
    return this.state.beginReplay(replayBoundary)
  }

  finishReplay(replayGeneration?: number): TerminalOutputEvent[] {
    return this.state.finishReplay(replayGeneration)
  }

  isReplaying(): boolean {
    return this.state.isReplaying()
  }

  drainReplay(replayGeneration?: number): void {
    this.state.discardReplay(replayGeneration)
  }

  acknowledgeResize(cols: number, rows: number): void {
    this.state.setCanonicalSize(cols, rows)
  }

  terminalRuntimeSessionIdsForClose(): string[] {
    const active = this.activeBinding()
    const retiring = this.retiringRuntimeBinding()
    const addressable = this.addressableRuntimeBinding()
    return Array.from(
      new Set(
        [active, retiring, addressable]
          .filter((binding): binding is TerminalRuntimeBinding => !!binding)
          .map((binding) => binding.terminalRuntimeSessionId),
      ),
    )
  }

  disposeTerminalRuntimeSessionIds(): string[] {
    const terminalRuntimeSessionIds = this.terminalRuntimeSessionIdsForClose()
    const binding = this.addressableRuntimeBinding()
    this.bindingState = { kind: 'closing', binding }
    this.restartOnStart = false
    return terminalRuntimeSessionIds
  }

  takePendingRestartTerminalRuntimeSessionIdForClose(): string | null {
    if (this.bindingState.kind !== 'transitioning' || this.bindingState.operation !== 'restart') return null
    const binding = this.bindingState.retiring
    this.bindingState = { kind: 'unbound' }
    return binding?.terminalRuntimeSessionId ?? null
  }

  private activeBinding(): TerminalRuntimeBinding | null {
    if (this.bindingState.kind === 'active') return this.bindingState.binding
    if (this.bindingState.kind === 'transitioning') return this.bindingState.active
    return null
  }

  private isCurrentAttempt(attempt: TerminalRuntimeAttemptToken): boolean {
    return (
      this.bindingState.kind === 'transitioning' &&
      this.bindingState.attemptId === attempt.attemptId &&
      this.bindingState.operation === attempt.operation
    )
  }

  private isValidAttemptResultBinding(attempt: TerminalRuntimeAttemptToken, result: TerminalRuntimeBinding): boolean {
    if (!Number.isSafeInteger(result.terminalRuntimeGeneration) || result.terminalRuntimeGeneration < 0) return false
    if (this.bindingState.kind !== 'transitioning') return false
    const known = this.bindingState.active ?? this.bindingState.retiring
    if (!known) return attempt.operation === 'attach'
    if (result.terminalRuntimeSessionId !== known.terminalRuntimeSessionId) return true
    return attempt.operation === 'restart'
      ? result.terminalRuntimeGeneration > known.terminalRuntimeGeneration
      : result.terminalRuntimeGeneration >= known.terminalRuntimeGeneration
  }
}

function bindingFrom(input: TerminalRuntimeBinding): TerminalRuntimeBinding {
  return {
    terminalRuntimeSessionId: input.terminalRuntimeSessionId,
    terminalRuntimeGeneration: input.terminalRuntimeGeneration,
  }
}

function sameBinding(a: TerminalRuntimeBinding, b: TerminalRuntimeBinding): boolean {
  return (
    a.terminalRuntimeSessionId === b.terminalRuntimeSessionId &&
    a.terminalRuntimeGeneration === b.terminalRuntimeGeneration
  )
}

function bindingKey(binding: TerminalRuntimeBinding): string {
  return `${binding.terminalRuntimeSessionId}:${binding.terminalRuntimeGeneration}`
}

function hydrationSupersedesResponse(
  hydration: TerminalRepoSessionHydration,
  response: TerminalRuntimeBinding,
): boolean {
  return !sameBinding(hydration, response)
}
