import type {
  TerminalBoundRuntimeMetadata,
  TerminalClientRole,
  TerminalOutputEvent,
  TerminalSessionPhase,
  TerminalSnapshotFrame,
  TerminalStreamFrame,
  TerminalTakeoverResult,
  TerminalResizeCommit,
} from '#/shared/terminal-types.ts'
import { TerminalSessionState } from '#/web/components/terminal/terminal-session-state.ts'
import type { TerminalOutputCheckpoint } from '#/web/components/terminal/terminal-session-state.ts'
import type {
  TerminalControllerViewModel,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'

export interface TerminalRuntimeBinding {
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}

export type TerminalRuntimeAttachResult =
  | ({ ok: true } & TerminalBoundRuntimeMetadata & TerminalStreamFrame)
  | ({ ok: true } & TerminalBoundRuntimeMetadata & TerminalSnapshotFrame)

export type TerminalRuntimeBindingClassification = 'active' | 'retiring' | 'future' | 'foreign'

export interface TerminalRuntimeAttemptToken {
  attemptId: number
  operation: 'attach' | 'restart'
}

export interface TerminalRepoSessionHydration extends TerminalRuntimeBinding {
  identityRevision: number
  phase: TerminalSessionPhase
  message: string | null
  processName: string
  canonicalTitle?: string | null
  role: TerminalIdentityViewModel['role']
  controllerStatus: TerminalIdentityViewModel['controllerStatus']
  canonicalSize: { cols: number; rows: number } | null
}

export type TerminalRuntimeHydrationResult =
  | { disposition: 'applied'; changed: boolean }
  | { disposition: 'ignored'; changed: false }
  | {
      disposition: 'staged'
      changed: false
      activationPending: boolean
    }

export type TerminalAuthoritativeHydrationSource = 'snapshot' | 'partial-effect'

export type TerminalRuntimeAttemptResult = {
  accepted: boolean
  changed: boolean
  resolution: 'response' | 'staged' | 'error' | 'superseded'
}

export type TerminalRuntimeLocalAttemptResolution = 'restored' | 'staged' | 'superseded'

type TerminalRuntimeBindingState =
  | { kind: 'unbound' }
  | { kind: 'active'; binding: TerminalRuntimeBinding }
  | {
      kind: 'transitioning'
      operation: 'attach' | 'restart'
      active: TerminalRuntimeBinding | null
      retiring: TerminalRuntimeBinding | null
      attemptId: number
      delivery: 'pending' | 'indeterminate'
    }
  | { kind: 'error'; addressableBinding: TerminalRuntimeBinding | null }
  | { kind: 'closing'; binding: TerminalRuntimeBinding | null }
  | { kind: 'closed'; lastBinding: TerminalRuntimeBinding | null }

export class TerminalSessionRuntime {
  private readonly state = new TerminalSessionState()
  private bindingState: TerminalRuntimeBindingState = { kind: 'unbound' }
  private nextAttemptId = 0
  private stagedAuthoritativeHydration: TerminalRepoSessionHydration | null = null

  snapshot() {
    const snapshot = this.state.snapshot(this.addressableRuntimeBinding()?.terminalRuntimeSessionId ?? null)
    if (this.bindingState.kind === 'transitioning' && this.bindingState.operation === 'restart') {
      return { ...snapshot, phase: 'restarting' as const, message: null }
    }
    return snapshot
  }

  phase(): 'opening' | 'restarting' | 'open' | 'error' | 'closed' {
    if (this.bindingState.kind === 'transitioning' && this.bindingState.operation === 'restart') return 'restarting'
    return this.state.getPhase()
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

  currentCanonicalSize(): { cols: number; rows: number } | null {
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

  startAttaching(): TerminalRuntimeAttemptToken {
    const active = this.activeBinding()
    const attempt = { attemptId: ++this.nextAttemptId, operation: 'attach' as const }
    this.bindingState = {
      kind: 'transitioning',
      operation: 'attach',
      active,
      retiring: null,
      attemptId: attempt.attemptId,
      delivery: 'pending',
    }
    return attempt
  }

  prepareRestart(): TerminalRuntimeAttemptToken | null {
    if (this.bindingState.kind === 'transitioning') return null
    const addressable = this.addressableRuntimeBinding()
    if (!addressable) return null
    if (addressable?.terminalRuntimeGeneration === 0) {
      const attempt = { attemptId: ++this.nextAttemptId, operation: 'attach' as const }
      this.bindingState = {
        kind: 'transitioning',
        operation: 'attach',
        active: addressable,
        retiring: null,
        attemptId: attempt.attemptId,
        delivery: 'pending',
      }
      return attempt
    }
    const attempt = { attemptId: ++this.nextAttemptId, operation: 'restart' as const }
    this.bindingState = {
      kind: 'transitioning',
      operation: 'restart',
      active: null,
      retiring: addressable,
      attemptId: attempt.attemptId,
      delivery: 'pending',
    }
    return attempt
  }

  currentAttemptToken(): TerminalRuntimeAttemptToken | null {
    return this.bindingState.kind === 'transitioning'
      ? { attemptId: this.bindingState.attemptId, operation: this.bindingState.operation }
      : null
  }

  currentAttemptIsIndeterminate(): boolean {
    return this.bindingState.kind === 'transitioning' && this.bindingState.delivery === 'indeterminate'
  }

  markStartAttemptIndeterminate(attempt: TerminalRuntimeAttemptToken): boolean {
    if (!this.isCurrentAttempt(attempt) || this.bindingState.kind !== 'transitioning') return false
    if (this.bindingState.delivery === 'indeterminate') return false
    this.bindingState.delivery = 'indeterminate'
    return true
  }

  commitAttachResult(
    attempt: TerminalRuntimeAttemptToken,
    result: TerminalRuntimeAttachResult & {
      role: TerminalIdentityViewModel['role']
      controllerStatus: TerminalIdentityViewModel['controllerStatus']
    },
  ): TerminalRuntimeAttemptResult {
    if (!this.isCurrentAttempt(attempt) || !this.isValidAttemptResultBinding(attempt, result)) {
      return { accepted: false, changed: false, resolution: 'superseded' }
    }
    const binding = bindingFrom(result)
    const staged = this.stagedAuthoritativeHydration
    if (staged) {
      return {
        accepted: true,
        changed: false,
        resolution: 'staged',
      }
    }
    this.stagedAuthoritativeHydration = null
    const previous = this.activeBinding()
    const metadata = this.applyRuntimeMetadata(result, !previous || !sameBinding(previous, binding))
    if (!metadata.accepted) {
      if (!previous) throw new Error('stale terminal identity cannot supersede an unbound attach')
      this.bindingState = { kind: 'active', binding: previous }
      return { accepted: false, changed: false, resolution: 'superseded' }
    }
    this.bindingState = { kind: 'active', binding }
    return {
      accepted: true,
      changed: !previous || !sameBinding(previous, binding) || metadata.changed,
      resolution: 'response',
    }
  }

  hydrateRepoSession(
    input: TerminalRepoSessionHydration,
    source: TerminalAuthoritativeHydrationSource = 'snapshot',
  ): TerminalRuntimeHydrationResult {
    if (this.bindingState.kind === 'transitioning') {
      if (source === 'snapshot' && this.bindingState.delivery === 'indeterminate') {
        const classification = this.classifyRuntimeBinding(input)
        if (classification === 'active' || classification === 'retiring') {
          this.stagedAuthoritativeHydration = null
          return { disposition: 'applied', changed: this.applyRepoHydration(input) }
        }
      }
      const activationPending =
        source === 'snapshot' &&
        this.classifyRuntimeBinding(input) === 'future' &&
        this.stageAuthoritativeHydration(input)
      return {
        disposition: 'staged',
        changed: false,
        activationPending,
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
    const metadata = this.applyRuntimeMetadata(input, !previous || !sameBinding(previous, binding))
    return !previous || !sameBinding(previous, binding) || metadata.changed
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
    if (current && sameBinding(current, input)) {
      if (current.identityRevision > input.identityRevision) return false
      if (current.identityRevision === input.identityRevision && !sameHydrationIdentity(current, input)) {
        throw new Error('staged terminal identity conflicts at the same revision')
      }
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

  failStartAttempt(attempt: TerminalRuntimeAttemptToken, message: string): TerminalRuntimeAttemptResult {
    if (!this.isCurrentAttempt(attempt)) {
      return { accepted: false, changed: false, resolution: 'superseded' }
    }
    const staged = this.stagedAuthoritativeHydration
    if (staged) {
      return {
        accepted: true,
        changed: false,
        resolution: 'staged',
      }
    }
    const addressableBinding = this.addressableRuntimeBinding()
    this.bindingState = { kind: 'error', addressableBinding }
    return { accepted: true, changed: this.state.setError(message), resolution: 'error' }
  }

  cancelStartAttempt(attempt: TerminalRuntimeAttemptToken): TerminalRuntimeLocalAttemptResolution {
    if (!this.isCurrentAttempt(attempt)) return 'superseded'
    if (this.stagedAuthoritativeHydration) return 'staged'
    if (this.bindingState.kind !== 'transitioning') return 'superseded'
    const previous = this.bindingState.active ?? this.bindingState.retiring
    this.bindingState = previous ? { kind: 'active', binding: previous } : { kind: 'unbound' }
    return 'restored'
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

  resetTransientState(): boolean {
    return this.state.resetTransientState()
  }

  handleOutput(event: TerminalOutputEvent): { changed: boolean; output: string | null } {
    if (this.classifyRuntimeBinding(event) !== 'active') return { changed: false, output: null }
    const changed = this.state.setProcessName(event.processName)
    if (this.state.captureReplayOutput(event)) return { changed, output: null }
    return { changed, output: event.data }
  }

  handleIdentity(event: TerminalIdentityViewModel): { accepted: boolean; changed: boolean } {
    if (this.classifyRuntimeBinding(event) !== 'active') return { accepted: false, changed: false }
    return this.state.applyIdentity(event)
  }

  handleLifecycle(event: TerminalLifecycleViewModel): boolean {
    if (this.classifyRuntimeBinding(event) !== 'active') return false
    return this.state.applyLifecycle(event)
  }

  applyTakeover(result: Extract<TerminalTakeoverResult, { ok: true }>): { accepted: boolean; changed: boolean } {
    if (this.classifyRuntimeBinding(result) !== 'active') return { accepted: false, changed: false }
    const identity = this.state.applyIdentity({
      identityRevision: result.identityRevision,
      role: result.role,
      controllerStatus: result.controllerStatus,
      canonicalSize: result.canonicalSize,
    })
    if (!identity.accepted) return identity
    const lifecycleChanged = this.state.applyLifecycle({
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      terminalRuntimeGeneration: result.terminalRuntimeGeneration,
      phase: result.phase,
      message: null,
    })
    return { accepted: true, changed: identity.changed || lifecycleChanged }
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

  drainReplay(replayGeneration?: number): void {
    this.state.discardReplay(replayGeneration)
  }

  commitResizeResult(result: TerminalResizeCommit): { accepted: boolean; changed: boolean } {
    const active = this.activeBinding()
    if (
      !active ||
      active.terminalRuntimeSessionId !== result.terminalRuntimeSessionId ||
      active.terminalRuntimeGeneration !== result.terminalRuntimeGeneration ||
      !this.state.isController()
    ) {
      return { accepted: false, changed: false }
    }
    return this.state.applyIdentity(result)
  }

  markClosing(): void {
    const binding = this.addressableRuntimeBinding()
    this.bindingState = { kind: 'closing', binding }
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
    if (!known) return false
    if (result.terminalRuntimeSessionId !== known.terminalRuntimeSessionId) return false
    if (attempt.operation === 'restart') {
      return (
        known.terminalRuntimeGeneration >= 1 && result.terminalRuntimeGeneration === known.terminalRuntimeGeneration + 1
      )
    }
    return known.terminalRuntimeGeneration === 0
      ? result.terminalRuntimeGeneration === 1
      : result.terminalRuntimeGeneration === known.terminalRuntimeGeneration
  }

  private applyRuntimeMetadata(
    input: TerminalRepoSessionHydration | (TerminalRuntimeAttachResult & TerminalControllerViewModel),
    establishIdentity: boolean,
  ): { accepted: boolean; changed: boolean } {
    const identity = establishIdentity
      ? { accepted: true, changed: this.state.establishIdentity(input) }
      : this.state.applyIdentity(input)
    if (!identity.accepted) return identity
    return {
      accepted: true,
      changed: this.state.applyRuntimeMetadata(input) || identity.changed,
    }
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

function sameHydrationIdentity(a: TerminalRepoSessionHydration, b: TerminalRepoSessionHydration): boolean {
  return (
    a.role === b.role &&
    a.controllerStatus === b.controllerStatus &&
    ((a.canonicalSize === null && b.canonicalSize === null) ||
      (a.canonicalSize !== null &&
        b.canonicalSize !== null &&
        a.canonicalSize.cols === b.canonicalSize.cols &&
        a.canonicalSize.rows === b.canonicalSize.rows))
  )
}
