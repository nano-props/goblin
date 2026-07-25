import type { ISearchResultChangeEvent } from '@xterm/addon-search'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type {
  TerminalAttachResult,
  TerminalExitEvent,
  TerminalAttachInput,
  TerminalOutputEvent,
  TerminalRestartInput,
  TerminalRestartResult,
  TerminalResizeResult,
} from '#/shared/terminal-types.ts'
import { terminalClient } from '#/web/terminal.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import { preloadTerminalFont } from '#/web/components/terminal/terminal-geometry.ts'
import {
  projectTerminalStartResultForClient,
  type TerminalStartResultWithController,
} from '#/web/components/terminal/terminal-session-projection.ts'
import {
  TerminalSessionRuntime,
  type TerminalAuthoritativeHydrationSource,
  type TerminalRuntimeAttemptToken,
  type TerminalRuntimeBinding,
  type TerminalRuntimeBindingClassification,
} from '#/web/components/terminal/terminal-session-runtime.ts'
import { TerminalSessionView } from '#/web/components/terminal/terminal-session-view.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { TerminalRenderQueue, type RenderedOutputCheckpoint } from '#/web/components/terminal/terminal-render-queue.ts'
import { terminalLog } from '#/web/logger.ts'
import {
  createTerminalWriteFailureReporter,
  type TerminalWriteFailureReporter,
} from '#/web/components/terminal/terminal-write-failure-feedback.ts'
import { toast } from 'sonner'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-socket-connection.ts'
import type {
  TerminalDescriptor,
  TerminalFocusRequest,
  TerminalInputWriter,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalSessionHydrationInput,
  TerminalSearchResult,
} from '#/web/components/terminal/types.ts'
const EMPTY_SEARCH_RESULT: TerminalSearchResult = { resultIndex: -1, resultCount: 0, found: false }

export type TerminalNotify = (...notification: ['metadata'] | ['projection-delta-revision', number]) => void

interface PendingOutputWrite {
  data: string
  checkpoint: RenderedOutputCheckpoint
}

interface PendingInputWrite {
  binding: TerminalRuntimeBinding
  data: string
}

interface PendingResize {
  cols: number
  rows: number
  startEpoch: number
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}

type TerminalResizeDispatch =
  | { kind: 'idle' }
  | { kind: 'scheduled'; proposal: PendingResize }
  | { kind: 'committing'; proposal: PendingResize; next: PendingResize | null }

interface InFlightTerminalStartOperation {
  attempt: TerminalRuntimeAttemptToken
  originEpoch: number
  promise: Promise<TerminalStartResultWithController | null>
}

export class TerminalSession {
  descriptor: TerminalDescriptor
  private readonly notify: TerminalNotify
  private readonly writeFailureReporter: TerminalWriteFailureReporter
  private readonly runtime = new TerminalSessionRuntime()
  private readonly view: TerminalSessionView
  private takeoverOperation: Promise<boolean> | null = null
  private startEpoch = 0
  private presentationAbortController: AbortController | null = null
  private resizeDispatch: TerminalResizeDispatch = { kind: 'idle' }
  private outputFlushFrame: number | null = null
  private renderQueue: TerminalRenderQueue | null = null
  private inFlightStartOperation: InFlightTerminalStartOperation | null = null
  private pendingOutput: PendingOutputWrite[] = []
  private pendingInputWrite: PendingInputWrite | null = null
  private inputFlushScheduled = false
  private renderedOutputCheckpoint: RenderedOutputCheckpoint | null = null
  private disposed = false

  constructor(
    descriptor: TerminalDescriptor,
    notify: TerminalNotify,
    writeFailureReporter: TerminalWriteFailureReporter = createTerminalWriteFailureReporter(),
  ) {
    this.descriptor = descriptor
    this.notify = notify
    this.writeFailureReporter = writeFailureReporter
    this.view = new TerminalSessionView({
      onInput: (data) => this.writeInput(data),
      onResize: ({ cols, rows }) => this.queueResize(cols, rows),
      onLayout: () => this.handleViewLayout(),
      onSearchResult: (event) => this.updateSearchResult(event),
      onProgress: (state, value) => this.updateProgress(state, value),
      onOpenExternalLink: (uri) => this.openExternalLink(uri),
    })
  }

  updateDescriptor(descriptor: TerminalDescriptor): void {
    this.descriptor = descriptor
  }

  attach(host: HTMLElement): void {
    if (this.disposed) return
    this.view.attach(host)
  }

  private handleViewLayout(): void {
    if (this.disposed || !this.view.isConnected()) return
    const term = this.view.currentTerminal()
    if (!term) {
      if (this.shouldStartAttachedSession()) this.start()
      return
    }
    if (!this.view.isPresented()) return
    if (!this.view.fitNow()) return
    this.queueResize(term.cols, term.rows)
  }

  focus(request?: TerminalFocusRequest): boolean {
    if (this.disposed) {
      request?.onSettled?.()
      return false
    }
    // A session may exist in the client projection before its React-owned view
    // has reached a stable mount. Keep the presentation-level focus intent
    // pending at that boundary so StrictMode's synthetic mount cleanup cannot
    // settle an intent that the stable mount still needs to fulfil.
    if (!this.view.isConnected()) return false
    if (!this.shouldStartAttachedSession()) {
      request?.onSettled?.()
      return false
    }
    if (!request && !this.view.isPresented()) return false
    this.view.focus(request)
    return true
  }

  private shouldStartAttachedSession(): boolean {
    // A mounted panel is only presentation capacity. Until authoritative
    // hydration supplies an addressable server binding (generation 0 for a
    // prepared session or a bound generation), there is nothing to attach.
    if (!this.runtime.addressableRuntimeBinding()) return false
    if (this.runtime.currentAttemptToken()) {
      return (
        !this.runtime.currentAttemptIsIndeterminate() &&
        (this.runtime.isController() || this.runtime.clientRole() === 'unowned')
      )
    }
    const phase = this.runtime.phase()
    if (phase !== 'opening' && phase !== 'open') return false
    return this.runtime.isController() || this.runtime.clientRole() === 'unowned'
  }

  resynchronizeConnectedView(): void {
    if (this.disposed || !this.view.isConnected()) return
    const transientChanged = this.replaceActiveView()
    if (transientChanged) this.notify('metadata')
  }

  detach(host: HTMLElement): void {
    if (this.view.detach(host) && this.destroyActiveView()) this.notify('metadata')
  }

  restart(): void {
    if (this.disposed) return
    const attempt = this.runtime.prepareRestart()
    if (!attempt) return
    this.replaceActiveView(attempt)
    this.notify('metadata')
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.presentationAbortController?.abort()
    this.presentationAbortController = null
    this.view.blurIfFocused()
    this.runtime.markClosing()
    this.destroyActiveView()
    this.view.disposeFrame()
  }

  snapshot() {
    const snapshot = this.runtime.snapshot()
    return this.takeoverOperation ? { ...snapshot, takeoverPending: true } : snapshot
  }

  isVisible(): boolean {
    return this.view.isVisible()
  }

  private writeInput(data: string): void {
    const binding = this.currentWritableInputBinding()
    if (binding) this.enqueueInput(binding, data)
  }

  captureInputWriter(): TerminalInputWriter | null {
    const binding = this.currentWritableInputBinding()
    if (!binding) return null
    return (data) => this.enqueueInput(binding, data)
  }

  private currentWritableInputBinding(): TerminalRuntimeBinding | null {
    if (!this.view.isPresented() || !this.view.currentTerminal() || !this.runtime.canSendInput()) return null
    return this.runtime.currentRuntimeBinding()
  }

  private enqueueInput(binding: TerminalRuntimeBinding, data: string): boolean {
    if (!data || !this.isCurrentInputBinding(binding)) return false
    const pending = this.pendingInputWrite
    if (pending && !sameRuntimeBinding(pending.binding, binding)) {
      throw new Error('terminal input queue contains conflicting runtime bindings')
    }
    this.pendingInputWrite = pending ? { binding: pending.binding, data: pending.data + data } : { binding, data }
    this.scheduleInputFlush()
    return true
  }

  private scheduleInputFlush(): void {
    if (this.disposed || this.inputFlushScheduled) return
    this.inputFlushScheduled = true
    queueMicrotask(() => {
      this.inputFlushScheduled = false
      this.flushInput()
    })
  }

  private flushInput(): void {
    if (this.disposed) return
    const pending = this.pendingInputWrite
    this.pendingInputWrite = null
    if (!pending || !this.isCurrentInputBinding(pending.binding)) return
    const { terminalRuntimeSessionId, terminalRuntimeGeneration } = pending.binding
    void terminalClient
      .write({ terminalRuntimeSessionId, terminalRuntimeGeneration, data: pending.data })
      .then((result) => {
        if (!this.isCurrentInputBinding(pending.binding)) return
        if (result.status !== 'accepted')
          this.writeFailureReporter.report({ terminalRuntimeSessionId, failure: { kind: 'result', result } })
      })
      .catch((err) => {
        if (!this.isCurrentInputBinding(pending.binding)) return
        this.writeFailureReporter.report({
          terminalRuntimeSessionId,
          failure: { kind: 'error', error: err },
        })
      })
  }

  private isCurrentInputBinding(binding: TerminalRuntimeBinding): boolean {
    if (this.disposed || !this.runtime.canSendInput()) return false
    const current = this.runtime.currentRuntimeBinding()
    return current !== null && sameRuntimeBinding(current, binding)
  }

  private flushResize(): void {
    const dispatch = this.resizeDispatch
    if (dispatch.kind !== 'scheduled') return
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    const terminalRuntimeGeneration = this.runtime.currentTerminalRuntimeGeneration()
    const resize = dispatch.proposal
    if (!terminalRuntimeSessionId || terminalRuntimeGeneration === null) {
      this.resizeDispatch = { kind: 'idle' }
      return
    }
    if (
      resize.startEpoch !== this.startEpoch ||
      resize.terminalRuntimeSessionId !== terminalRuntimeSessionId ||
      resize.terminalRuntimeGeneration !== terminalRuntimeGeneration ||
      !this.view.isPresented()
    ) {
      this.resizeDispatch = { kind: 'idle' }
      return
    }
    if (!this.runtime.isController()) {
      this.resizeDispatch = { kind: 'idle' }
      return
    }
    const { cols, rows } = resize
    const canonicalSize = this.runtime.currentCanonicalSize()
    if (canonicalSize?.cols === cols && canonicalSize.rows === rows) {
      this.resizeDispatch = { kind: 'idle' }
      return
    }
    this.resizeDispatch = { kind: 'committing', proposal: resize, next: null }
    void this.commitResize(resize)
  }

  private async commitResize(proposal: PendingResize): Promise<void> {
    const { terminalRuntimeSessionId, terminalRuntimeGeneration, cols, rows } = proposal
    let result: TerminalResizeResult
    try {
      result = await terminalClient.resize({ terminalRuntimeSessionId, terminalRuntimeGeneration, cols, rows })
    } catch (error) {
      this.finishResizeCommit(proposal, { ok: false, message: 'error.unavailable' }, error)
      return
    }
    this.finishResizeCommit(proposal, result, null)
  }

  private finishResizeCommit(proposal: PendingResize, result: TerminalResizeResult, error: unknown): void {
    const dispatch = this.resizeDispatch
    if (dispatch.kind !== 'committing' || !sameResizeProposal(dispatch.proposal, proposal)) return
    if (!this.isCurrentResizeProposal(proposal)) {
      this.resizeDispatch = { kind: 'idle' }
      return
    }
    if (
      !result.ok ||
      result.terminalRuntimeSessionId !== proposal.terminalRuntimeSessionId ||
      result.terminalRuntimeGeneration !== proposal.terminalRuntimeGeneration ||
      result.canonicalSize.cols !== proposal.cols ||
      result.canonicalSize.rows !== proposal.rows
    ) {
      this.resizeDispatch = { kind: 'idle' }
      terminalLog.warn('terminal resize was not committed; recovering the authoritative frame', {
        terminalRuntimeSessionId: proposal.terminalRuntimeSessionId,
        cols: proposal.cols,
        rows: proposal.rows,
        error,
      })
      this.replaceActiveView(undefined, { preserveTransientState: true })
      return
    }
    const commit = this.runtime.commitResizeResult(result)
    if (!commit.accepted) {
      const next = dispatch.next
      if (next) this.scheduleResize(next)
      else this.resizeDispatch = { kind: 'idle' }
      return
    }
    if (commit.changed) this.notify('metadata')
    const next = dispatch.next
    if (!next) {
      this.resizeDispatch = { kind: 'idle' }
      return
    }
    this.scheduleResize(next)
  }

  private isCurrentResizeProposal(proposal: PendingResize): boolean {
    return (
      !this.disposed &&
      this.startEpoch === proposal.startEpoch &&
      this.view.isPresented() &&
      this.runtime.isController() &&
      this.runtime.currentTerminalRuntimeSessionId() === proposal.terminalRuntimeSessionId &&
      this.runtime.currentTerminalRuntimeGeneration() === proposal.terminalRuntimeGeneration
    )
  }

  findNext(term: string, incremental = false): TerminalSearchResult {
    return this.find(term, 'next', incremental)
  }

  findPrevious(term: string): TerminalSearchResult {
    return this.find(term, 'previous', false)
  }

  clearSearch(): void {
    this.view.clearSearch()
    this.setSearchResult(null)
  }

  scrollToBottom(): void {
    this.view.scrollToBottom()
  }

  scrollLines(amount: number): void {
    this.view.scrollLines(amount)
  }

  currentTerminalRuntimeSessionId(): string | null {
    return this.runtime.currentTerminalRuntimeSessionId()
  }

  currentRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.runtime.currentRuntimeBinding()
  }

  controlsTerminal(): boolean {
    return this.runtime.isController()
  }

  addressableRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.runtime.addressableRuntimeBinding()
  }

  classifyRuntimeBinding(binding: TerminalRuntimeBinding): TerminalRuntimeBindingClassification {
    return this.runtime.classifyRuntimeBinding(binding)
  }

  hydrate(input: TerminalSessionHydrationInput, source: TerminalAuthoritativeHydrationSource = 'snapshot'): void {
    const previousBinding = this.runtime.currentRuntimeBinding()
    const hydration = this.runtime.hydrateRepoSession(
      {
        terminalRuntimeSessionId: input.terminalRuntimeSessionId,
        terminalRuntimeGeneration: input.terminalRuntimeGeneration,
        identityRevision: input.identityRevision,
        phase: input.phase,
        message: input.message,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle ?? null,
        role: input.role,
        controllerStatus: input.controllerStatus,
        canonicalSize: input.canonicalSize,
      },
      source,
    )
    if (hydration.disposition === 'staged') {
      if (hydration.activationPending) this.notify('metadata')
      return
    }
    if (hydration.disposition === 'ignored') return
    this.applyHydrationInput(hydration.changed, previousBinding)
  }

  private applyHydrationInput(
    changed: boolean,
    previousBinding: TerminalRuntimeBinding | null,
    notifyChange = true,
  ): void {
    if (changed) this.reconcileViewOwnership(previousBinding)
    if (changed && notifyChange) this.notify('metadata')
  }

  pendingAuthoritativeRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.runtime.pendingAuthoritativeRuntimeBinding()
  }

  commitPendingAuthoritativeHydration(binding: TerminalRuntimeBinding): boolean {
    const previousBinding = this.runtime.currentRuntimeBinding()
    const committed = this.runtime.commitPendingAuthoritativeHydration(binding)
    if (!committed.accepted) return false
    this.applyHydrationInput(committed.changed, previousBinding, false)
    return true
  }

  private applySettledStagedHydration(): void {
    if (!this.runtime.pendingAuthoritativeRuntimeBinding()) return
    this.notify('metadata')
  }

  handleOutput(event: TerminalOutputEvent): void {
    if (this.isOutputAlreadyRendered(event)) return
    const result = this.runtime.handleOutput(event)
    if (result.changed) this.notify('metadata')
    if (result.output && this.runtime.isController()) {
      this.queueOutput(result.output, this.checkpointFromOutputEvent(event))
    }
  }

  handleIdentity(event: TerminalIdentityViewModel): void {
    const previousBinding = this.runtime.currentRuntimeBinding()
    const identity = this.runtime.handleIdentity(event)
    if (!identity.accepted || !identity.changed) return
    this.reconcileViewOwnership(previousBinding)
    this.notify('metadata')
  }

  handleLifecycle(event: TerminalLifecycleViewModel): void {
    // Lifecycle updates never touch the xterm. They are pure state
    // mutations: phase and message. The teardown
    // decision is gated by `handleIdentity`; a phase-only change
    // is rendered into the snapshot (and only the snapshot) so
    // the user sees the new phase banner without losing the
    // existing xterm.
    const changed = this.runtime.handleLifecycle(event)
    if (!changed) return
    this.notify('metadata')
  }

  private reconcileViewOwnership(previousBinding: TerminalRuntimeBinding | null): void {
    const binding = this.runtime.currentRuntimeBinding()
    const bindingChanged = previousBinding !== null && !sameRuntimeBinding(previousBinding, binding)
    if (this.view.currentTerminal() && (bindingChanged || !this.runtime.isController())) {
      if (bindingChanged && this.runtime.isController()) {
        this.replaceActiveView(undefined, { preserveTransientState: true })
        return
      }
      this.destroyActiveView({ preserveTransientState: true })
    }
    if (!this.view.isConnected() || this.view.currentTerminal()) return
    if (this.shouldStartAttachedSession()) this.start()
  }

  handleServerTitle(canonicalTitle: string | null): void {
    if (this.runtime.setCanonicalTitle(canonicalTitle)) this.notify('metadata')
  }

  handleExit(event: TerminalExitEvent): boolean {
    if (!this.runtime.handleExit(event)) return false
    this.flushOutput(event)
    this.view.blurIfFocused()
    return true
  }

  async takeover(): Promise<boolean> {
    if (this.disposed) return false
    if (this.runtime.isController()) return true
    if (this.takeoverOperation) return await this.takeoverOperation
    const binding = this.runtime.currentRuntimeBinding()
    if (!binding || this.view.currentTerminal() || !this.view.isConnected() || !this.view.canOpenTerminal()) {
      return false
    }
    const epoch = (this.startEpoch += 1)
    const operation = this.takeoverAsync(epoch, binding)
    this.takeoverOperation = operation
    this.notify('metadata')
    try {
      return await operation
    } finally {
      if (this.takeoverOperation === operation) {
        this.takeoverOperation = null
        this.notify('metadata')
      }
    }
  }

  private async takeoverAsync(epoch: number, binding: TerminalRuntimeBinding): Promise<boolean> {
    const presentationAbortController = this.beginPendingPresentation()
    try {
      const term = await this.openPhase(epoch)
      const result = await terminalClient.takeover({
        ...binding,
        cols: term.cols,
        rows: term.rows,
      })
      const current = this.runtime.currentRuntimeBinding()
      if (
        !result.ok ||
        !current ||
        current.terminalRuntimeSessionId !== binding.terminalRuntimeSessionId ||
        current.terminalRuntimeGeneration !== binding.terminalRuntimeGeneration
      ) {
        if (this.isCurrentStart(epoch, term)) this.destroyActiveView({ preserveTransientState: true })
        return false
      }
      const metadata = this.runtime.applyTakeover(result)
      if (!this.runtime.isController()) {
        if (this.isCurrentStart(epoch, term)) this.destroyActiveView({ preserveTransientState: true })
        if (metadata.changed) this.notify('metadata')
        return false
      }
      if (metadata.changed) this.notify('metadata')
      if (!this.isCurrentStart(epoch, term)) {
        if (this.view.isConnected()) this.start()
        return true
      }
      const attempt = this.runtime.startAttaching()
      void this.bindAndPresent(epoch, attempt, term, presentationAbortController)
      return true
    } catch (error) {
      if (this.isCurrentStartEpoch(epoch)) this.destroyActiveView({ preserveTransientState: true })
      if (!(error instanceof StartCancelledError)) {
        terminalLog.warn('takeover failed for terminal session', {
          terminalRuntimeSessionId: binding.terminalRuntimeSessionId,
          error,
        })
      }
      return false
    }
  }

  private start(preparedAttempt?: TerminalRuntimeAttemptToken): void {
    if (this.disposed || this.view.currentTerminal() || !this.view.isConnected() || !this.view.canOpenTerminal()) return
    const epoch = (this.startEpoch += 1)
    let attempt = preparedAttempt ?? null
    const currentAttempt = this.runtime.currentAttemptToken()
    if (!attempt && currentAttempt) {
      attempt = currentAttempt
    } else if (!attempt) {
      attempt = this.runtime.startAttaching()
    }
    if (!attempt) return
    if (this.runtime.currentAttemptIsIndeterminate()) return
    void this.startAsync(epoch, attempt)
  }

  private async startAsync(epoch: number, attempt: TerminalRuntimeAttemptToken): Promise<void> {
    const presentationAbortController = this.beginPendingPresentation()
    let term: XTermTerminal
    try {
      term = await this.openPhase(epoch)
    } catch (error) {
      this.failPresentationStart(epoch, attempt, error)
      return
    }
    await this.bindAndPresent(epoch, attempt, term, presentationAbortController)
  }

  private beginPendingPresentation(): AbortController {
    const controller = new AbortController()
    this.presentationAbortController?.abort()
    this.presentationAbortController = controller
    return controller
  }

  private async bindAndPresent(
    epoch: number,
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
    presentationAbortController: AbortController,
  ): Promise<boolean> {
    let currentAttempt = attempt
    try {
      binding: for (;;) {
        const result = await this.ipcPhase(epoch, currentAttempt, term)
        if (!result) {
          this.assertCurrentStart(epoch, term)
          if (!this.runtime.isController()) {
            this.destroyActiveView({ preserveTransientState: true })
            return false
          }
          currentAttempt = this.runtime.startAttaching()
          continue
        }
        if (result.frame === 'snapshot') await this.replayPhase(epoch, term, result)
        this.assertCurrentStart(epoch, term)
        if (!this.runtime.isController()) {
          this.destroyActiveView({ preserveTransientState: true })
          return false
        }
        if (!this.view.fitNow()) throw new Error('terminal fit measurement failed')
        const canonicalSize = this.runtime.currentCanonicalSize()
        if (
          this.runtime.phase() === 'open' &&
          (canonicalSize?.cols !== term.cols || canonicalSize.rows !== term.rows)
        ) {
          currentAttempt = this.runtime.startAttaching()
          continue
        }
        this.assertCurrentStart(epoch, term)
        const presentation = await this.view.present(term, presentationAbortController.signal)
        if (presentation === 'cancelled') throw new StartCancelledError()
        if (presentation === 'presented') break binding
        if (!this.view.fitNow()) throw new Error('terminal fit measurement failed')
        this.assertCurrentStart(epoch, term)
        if (this.runtime.phase() === 'open') {
          currentAttempt = this.runtime.startAttaching()
          continue binding
        }
      }
      this.assertCurrentStart(epoch, term)
      if (this.presentationAbortController === presentationAbortController) this.presentationAbortController = null
      this.flushOutput()
      this.queueResize(term.cols, term.rows)
      return true
    } catch (err) {
      this.failPresentationStart(epoch, currentAttempt, err)
      return false
    }
  }

  private failPresentationStart(epoch: number, attempt: TerminalRuntimeAttemptToken, error: unknown): void {
    if (!this.isCurrentStartEpoch(epoch)) return
    const resolution = this.runtime.cancelStartAttempt(attempt)
    if (resolution === 'staged') {
      this.applySettledStagedHydration()
    } else if (resolution === 'restored') {
      this.notify('metadata')
    }
    this.destroyActiveView({ preserveTransientState: true })
    if (!(error instanceof StartCancelledError)) {
      terminalLog.warn('terminal presentation failed', {
        terminalRuntimeSessionId: this.runtime.addressableRuntimeBinding()?.terminalRuntimeSessionId ?? null,
        error,
      })
    }
  }

  private async openPhase(epoch: number): Promise<XTermTerminal> {
    if (this.disposed || this.startEpoch !== epoch || this.view.currentTerminal()) throw new StartCancelledError()
    await preloadTerminalFont()
    if (this.disposed || this.startEpoch !== epoch || !this.view.canOpenTerminal()) throw new StartCancelledError()
    const term = this.view.openTerminal((data) => this.writeInput(data))
    this.renderQueue = new TerminalRenderQueue(term, {
      isCurrent: () => !this.disposed && this.view.currentTerminal() === term,
      isCheckpointRendered: (checkpoint) => this.isCheckpointRendered(checkpoint),
      markOutputRendered: (checkpoint) => this.markOutputRendered(checkpoint),
    })
    if (!this.view.fitNow()) throw new Error('terminal fit measurement failed')
    this.assertCurrentStart(epoch, term)
    return term
  }

  private async ipcPhase(
    epoch: number,
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
  ): Promise<TerminalStartResultWithController | null> {
    const existing = this.inFlightStartOperation
    if (existing && !sameAttempt(existing.attempt, attempt)) {
      try {
        await existing.promise
      } finally {
        this.clearInFlightStartOperation(existing)
      }
      this.assertCurrentStart(epoch, term)
      return null
    }
    const operation = this.startOperation(attempt, term, epoch)
    let result: TerminalStartResultWithController | null
    try {
      result = await operation.promise
    } finally {
      this.clearInFlightStartOperation(operation)
    }
    this.assertCurrentStart(epoch, term)
    if (result) return operation.originEpoch === epoch ? result : null
    if (this.runtime.currentAttemptIsIndeterminate()) {
      this.suspendActiveViewForAuthoritativeRecovery()
    } else {
      this.destroyActiveView({ preserveTransientState: true })
    }
    throw new StartCancelledError()
  }

  private startOperation(
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
    originEpoch: number,
  ): InFlightTerminalStartOperation {
    const current = this.inFlightStartOperation
    if (current) {
      if (sameAttempt(current.attempt, attempt)) return current
      throw new Error('conflicting terminal start operation')
    }
    const completion = Promise.withResolvers<TerminalStartResultWithController | null>()
    const operation: InFlightTerminalStartOperation = { attempt, originEpoch, promise: completion.promise }
    this.inFlightStartOperation = operation
    void this.executeStartOperation(attempt, term).then(completion.resolve, completion.reject)
    return operation
  }

  private async executeStartOperation(
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
  ): Promise<TerminalStartResultWithController | null> {
    const restart = attempt.operation === 'restart'
    const requestedSize = { cols: term.cols, rows: term.rows }
    const terminalRuntimeSessionId = restart
      ? this.runtime.restartingTerminalRuntimeSessionId()
      : this.runtime.currentTerminalRuntimeSessionId()
    if (!terminalRuntimeSessionId) {
      const failed = this.runtime.failStartAttempt(attempt, 'error.invalid-arguments')
      if (failed.resolution === 'staged') this.applySettledStagedHydration()
      else if (failed.accepted && failed.changed) this.notify('metadata')
      return null
    }

    let result: TerminalAttachResult | TerminalRestartResult
    try {
      result = restart
        ? await terminalClient.restart(this.terminalRestartInput(terminalRuntimeSessionId, term))
        : await terminalClient.attach(this.terminalAttachInput(terminalRuntimeSessionId, term))
    } catch (error) {
      if (error instanceof ClientRealtimeRequestError && error.delivery === 'indeterminate') {
        this.runtime.markStartAttemptIndeterminate(attempt)
        terminalLog.warn('terminal start delivery is indeterminate; awaiting authoritative recovery', {
          terminalRuntimeSessionId,
          operation: attempt.operation,
          error,
        })
        return null
      }
      const resolution = this.runtime.cancelStartAttempt(attempt)
      if (resolution === 'staged') this.applySettledStagedHydration()
      else if (resolution === 'restored') this.notify('metadata')
      terminalLog.warn('terminal start request failed before an authoritative response', {
        terminalRuntimeSessionId,
        operation: attempt.operation,
        error,
      })
      return null
    }

    if (!result.ok) {
      const failed = this.runtime.failStartAttempt(attempt, result.message)
      if (failed.resolution === 'staged') this.applySettledStagedHydration()
      else if (failed.accepted && failed.changed) this.notify('metadata')
      return null
    }

    const projected = this.withLocalController(result)
    if (
      projected.role === 'controller' &&
      projected.phase === 'open' &&
      (projected.canonicalSize.cols !== requestedSize.cols || projected.canonicalSize.rows !== requestedSize.rows)
    ) {
      throw new Error('terminal start response did not commit the requested controller geometry')
    }
    const committed = this.runtime.commitAttachResult(attempt, projected)
    if (!committed.accepted) {
      const admittedAttempt = this.runtime.currentAttemptToken()
      const attemptStillCurrent = admittedAttempt !== null && sameAttempt(admittedAttempt, attempt)
      if (attemptStillCurrent) {
        const failed = this.runtime.failStartAttempt(attempt, 'error.unavailable')
        if (failed.resolution === 'staged') this.applySettledStagedHydration()
        else if (failed.accepted && failed.changed) this.notify('metadata')
        terminalLog.warn('terminal start response violated the admitted generation transition', {
          terminalRuntimeSessionId,
          operation: attempt.operation,
          terminalRuntimeGeneration: projected.terminalRuntimeGeneration,
        })
      }
      return null
    }
    if (committed.resolution === 'staged') {
      this.applySettledStagedHydration()
      return null
    }
    if (committed.changed) this.notify('metadata')
    this.notifyAttachProjectionRevision(projected)
    return projected
  }

  private clearInFlightStartOperation(operation: InFlightTerminalStartOperation): void {
    if (this.inFlightStartOperation === operation) this.inFlightStartOperation = null
  }

  private async replayPhase(
    epoch: number,
    term: XTermTerminal,
    result: Extract<TerminalStartResultWithController, { frame: 'snapshot' }>,
  ): Promise<void> {
    await this.replayActiveView(epoch, term, result.snapshot, {
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      terminalRuntimeGeneration: result.terminalRuntimeGeneration,
      seq: result.snapshotSeq,
    })
    this.assertCurrentStart(epoch, term)
  }

  private notifyAttachProjectionRevision(result: TerminalStartResultWithController): void {
    if (result.terminalProjectionEffect.kind === 'delta') {
      this.notify('projection-delta-revision', result.terminalProjectionEffect.revision)
    }
  }

  private assertCurrentStart(epoch: number, term: XTermTerminal): void {
    if (this.disposed || this.startEpoch !== epoch || this.view.currentTerminal() !== term) {
      throw new StartCancelledError()
    }
  }

  private terminalAttachInput(terminalRuntimeSessionId: string, term: XTermTerminal): TerminalAttachInput {
    const terminalRuntimeGeneration = this.runtime.currentTerminalRuntimeGeneration()
    if (terminalRuntimeGeneration === null) throw new StartCancelledError()
    return {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private terminalRestartInput(terminalRuntimeSessionId: string, term: XTermTerminal): TerminalRestartInput {
    const retiring = this.runtime.retiringRuntimeBinding()
    if (!retiring) throw new StartCancelledError()
    return {
      terminalRuntimeSessionId,
      terminalRuntimeGeneration: retiring.terminalRuntimeGeneration,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private withLocalController(
    result: Extract<TerminalAttachResult | TerminalRestartResult, { ok: true }>,
  ): TerminalStartResultWithController {
    const clientId = readClientPageId()
    return projectTerminalStartResultForClient(result, clientId)
  }

  private async replayActiveView(
    epoch: number,
    term: XTermTerminal,
    replay: string,
    replayCheckpoint: RenderedOutputCheckpoint,
  ): Promise<void> {
    const replayGeneration = this.runtime.beginReplay(replayCheckpoint)
    try {
      const applied = await this.enqueueRenderReplace(term, replay, replayCheckpoint)
      if (!applied) this.runtime.drainReplay(replayGeneration)
    } finally {
      if (this.isCurrentStart(epoch, term)) {
        for (const event of this.runtime.finishReplay(replayGeneration)) {
          this.queueOutput(event.data, this.checkpointFromOutputEvent(event))
        }
      } else {
        this.runtime.drainReplay(replayGeneration)
      }
    }
  }

  private queueResize(cols: number, rows: number): void {
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    const terminalRuntimeGeneration = this.runtime.currentTerminalRuntimeGeneration()
    if (!terminalRuntimeSessionId || terminalRuntimeGeneration === null || !this.runtime.canSendInput()) return
    if (!this.view.isPresented()) return
    const canonicalSize = this.runtime.currentCanonicalSize()
    if (canonicalSize?.cols === cols && canonicalSize.rows === rows && this.resizeDispatch.kind === 'idle') return
    const proposal: PendingResize = {
      cols,
      rows,
      startEpoch: this.startEpoch,
      terminalRuntimeSessionId,
      terminalRuntimeGeneration,
    }
    if (this.resizeDispatch.kind === 'committing') {
      this.resizeDispatch = { ...this.resizeDispatch, next: proposal }
      return
    }
    this.scheduleResize(proposal)
  }

  private scheduleResize(proposal: PendingResize): void {
    const alreadyScheduled = this.resizeDispatch.kind === 'scheduled'
    this.resizeDispatch = { kind: 'scheduled', proposal }
    if (alreadyScheduled) return
    queueMicrotask(() => {
      this.flushResize()
    })
  }

  private cancelResizeDispatch(): void {
    this.resizeDispatch = { kind: 'idle' }
  }

  private queueOutput(data: string, checkpoint: RenderedOutputCheckpoint): void {
    if (!this.view.currentTerminal()) return
    this.pendingOutput.push({ data, checkpoint })
    if (!this.view.isPresented()) return
    if (this.outputFlushFrame !== null) return
    this.outputFlushFrame = requestAnimationFrame(() => {
      this.outputFlushFrame = null
      this.flushOutput()
    })
  }

  private flushOutput(binding: TerminalRuntimeBinding | null = this.runtime.currentRuntimeBinding()): void {
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    if (!this.pendingOutput.length) return
    const pendingOutput = this.pendingOutput
    this.pendingOutput = []
    if (!binding) return
    const currentOutput = pendingOutput.filter((entry) => sameRenderedBinding(entry.checkpoint, binding))
    if (!currentOutput.length) return
    const output = currentOutput.map((entry) => entry.data).join('')
    const checkpoint = latestCheckpoint(currentOutput.map((entry) => entry.checkpoint))
    const term = this.view.currentTerminal()
    if (!term || !checkpoint) return
    void this.enqueueRenderAppend(term, output, checkpoint).catch((error) => {
      this.recoverFromRenderFailure(term, error)
    })
  }

  private clearPendingOutput(): void {
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    this.pendingOutput = []
    this.clearRenderQueue()
  }

  private enqueueRenderReplace(
    term: XTermTerminal,
    data: string,
    checkpoint: RenderedOutputCheckpoint,
  ): Promise<boolean> {
    const renderQueue = this.renderQueue
    if (!renderQueue || this.view.currentTerminal() !== term) return Promise.resolve(false)
    this.clearPendingOutput()
    return renderQueue.replace(data, checkpoint)
  }

  private enqueueRenderAppend(
    term: XTermTerminal,
    data: string,
    checkpoint: RenderedOutputCheckpoint,
  ): Promise<boolean> {
    const renderQueue = this.renderQueue
    if (!renderQueue || this.view.currentTerminal() !== term) return Promise.resolve(false)
    return renderQueue.append(data, checkpoint)
  }

  private clearRenderQueue(): void {
    this.renderQueue?.clear()
  }

  private recoverFromRenderFailure(term: XTermTerminal, error: unknown): void {
    if (this.disposed || this.view.currentTerminal() !== term) return
    terminalLog.warn('terminal output render failed; rebuilding from the authoritative snapshot', {
      terminalRuntimeSessionId: this.runtime.currentTerminalRuntimeSessionId(),
      error,
    })
    this.replaceActiveView(undefined, { preserveTransientState: true })
  }

  private isOutputAlreadyRendered(event: TerminalOutputEvent): boolean {
    const checkpoint = this.renderedOutputCheckpoint
    if (!checkpoint || !sameRenderedBinding(checkpoint, event)) return false
    return event.seq <= checkpoint.seq
  }

  private isCheckpointRendered(checkpoint: RenderedOutputCheckpoint): boolean {
    const current = this.renderedOutputCheckpoint
    if (!current || !sameRenderedBinding(current, checkpoint)) return false
    return checkpoint.seq <= current.seq
  }

  private markOutputRendered(checkpoint: RenderedOutputCheckpoint): void {
    const binding = this.runtime.currentRuntimeBinding()
    if (!binding || !sameRenderedBinding(binding, checkpoint)) return
    const current = this.renderedOutputCheckpoint
    if (!current || !sameRenderedBinding(current, checkpoint)) {
      this.renderedOutputCheckpoint = normalizeRenderedOutputCheckpoint(checkpoint)
    } else if (checkpoint.seq > current.seq) {
      this.renderedOutputCheckpoint = normalizeRenderedOutputCheckpoint(checkpoint)
    }
  }

  private checkpointFromOutputEvent(event: TerminalOutputEvent): RenderedOutputCheckpoint {
    return {
      terminalRuntimeSessionId: event.terminalRuntimeSessionId,
      terminalRuntimeGeneration: event.terminalRuntimeGeneration,
      seq: event.seq,
    }
  }

  private destroyActiveView(options?: { preserveTransientState?: boolean }): boolean {
    this.presentationAbortController?.abort()
    this.presentationAbortController = null
    this.cancelResizeDispatch()
    this.clearPendingOutput()
    if (this.pendingInputWrite && !this.isCurrentInputBinding(this.pendingInputWrite.binding)) {
      this.pendingInputWrite = null
    }
    this.startEpoch += 1
    const transientChanged = options?.preserveTransientState ? false : this.runtime.resetTransientState()
    this.renderQueue = null
    this.view.destroyTerminal()
    return transientChanged
  }

  private replaceActiveView(
    preparedAttempt?: TerminalRuntimeAttemptToken,
    options?: { preserveTransientState?: boolean },
  ): boolean {
    const focusRequest = this.view.takeFocusRequestForRebuild()
    const transientChanged = this.destroyActiveView(options)
    if (!this.view.isConnected() || !this.shouldStartAttachedSession()) {
      focusRequest?.onSettled?.()
      return transientChanged
    }
    if (focusRequest) this.view.focus(focusRequest)
    this.start(preparedAttempt)
    return transientChanged
  }

  private suspendActiveViewForAuthoritativeRecovery(): void {
    const focusRequest = this.view.takeFocusRequestForRebuild()
    this.destroyActiveView({ preserveTransientState: true })
    if (focusRequest && this.view.isConnected()) this.view.focus(focusRequest)
    else focusRequest?.onSettled?.()
  }

  private isCurrentStart(epoch: number, term: XTermTerminal): boolean {
    return !this.disposed && this.startEpoch === epoch && this.view.currentTerminal() === term
  }

  private isCurrentStartEpoch(epoch: number): boolean {
    return !this.disposed && this.startEpoch === epoch
  }

  private updateProgress(state: number, value: number): void {
    if (this.runtime.setProgress(state, value)) this.notify('metadata')
  }

  private find(term: string, direction: 'next' | 'previous', incremental: boolean): TerminalSearchResult {
    if (!term) {
      this.clearSearch()
      return EMPTY_SEARCH_RESULT
    }
    const found = this.view.find(term, direction, incremental)
    if (!found) this.setSearchResult(EMPTY_SEARCH_RESULT)
    return this.runtime.currentSearchResult() ?? { ...EMPTY_SEARCH_RESULT, found }
  }

  private updateSearchResult(event: ISearchResultChangeEvent): void {
    this.setSearchResult({
      resultIndex: event.resultIndex,
      resultCount: event.resultCount,
      found: event.resultCount > 0,
    })
  }

  private setSearchResult(result: TerminalSearchResult | null): void {
    if (this.runtime.setSearchResult(result)) this.notify('metadata')
  }

  private openExternalLink(uri: string): void {
    if (!isHttpExternalUrl(uri)) return
    void openExternalUrl(uri).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : String(err))
    })
  }
}

function cancelScheduledAnimationFrame(frame: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  else clearTimeout(frame)
}

function latestCheckpoint(checkpoints: RenderedOutputCheckpoint[]): RenderedOutputCheckpoint | null {
  return checkpoints.reduce<RenderedOutputCheckpoint | null>((latest, checkpoint) => {
    if (!latest) return checkpoint
    if (!sameRenderedBinding(checkpoint, latest)) return latest
    return checkpoint.seq > latest.seq ? checkpoint : latest
  }, null)
}

function sameRenderedBinding(
  a: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number },
  b: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number },
): boolean {
  return (
    a.terminalRuntimeSessionId === b.terminalRuntimeSessionId &&
    a.terminalRuntimeGeneration === b.terminalRuntimeGeneration
  )
}

function sameRuntimeBinding(a: TerminalRuntimeBinding | null, b: TerminalRuntimeBinding | null): boolean {
  if (!a || !b) return a === b
  return sameRenderedBinding(a, b)
}

function sameResizeProposal(a: PendingResize, b: PendingResize): boolean {
  return a.cols === b.cols && a.rows === b.rows && a.startEpoch === b.startEpoch && sameRenderedBinding(a, b)
}

function sameAttempt(a: TerminalRuntimeAttemptToken, b: TerminalRuntimeAttemptToken): boolean {
  return a.attemptId === b.attemptId && a.operation === b.operation
}

function normalizeRenderedOutputCheckpoint(checkpoint: RenderedOutputCheckpoint): RenderedOutputCheckpoint {
  return {
    terminalRuntimeSessionId: checkpoint.terminalRuntimeSessionId,
    terminalRuntimeGeneration: checkpoint.terminalRuntimeGeneration,
    seq: normalizeOutputNumber(checkpoint.seq),
  }
}

function normalizeOutputNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function isHttpExternalUrl(value: string): boolean {
  try {
    if (value.length > 4096 || /[\0-\x1f\x7f]/.test(value)) return false
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

class StartCancelledError extends Error {
  constructor() {
    super('start cancelled')
  }
}
