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
} from '#/shared/terminal-types.ts'
import { terminalClient } from '#/web/terminal.ts'
import { setTerminalFocused } from '#/web/terminal-focus.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  preloadTerminalFont,
} from '#/web/components/terminal/terminal-geometry.ts'
import {
  TerminalHostNotMeasurableError,
  waitForMeasurableHost,
} from '#/web/components/terminal/terminal-session-geometry.ts'
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
import {
  isExternalCommandInput,
  isTerminalEmulatorInput,
  type TerminalInput,
} from '#/web/components/terminal/terminal-input.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import {
  createXtermAuthorityGate,
  type AuthorizationDenialReason,
  type TerminalAuthorityGate,
} from '#/web/components/terminal/authority-gate.ts'
import { TerminalRenderQueue, type RenderedOutputCheckpoint } from '#/web/components/terminal/terminal-render-queue.ts'
import { WRITE_BLOCKED_KEY_BY_REASON } from '#/web/components/terminal/authority-denial-feedback.ts'
import { terminalLog } from '#/web/logger.ts'
import {
  createTerminalWriteFailureReporter,
  type TerminalWriteFailureReporter,
} from '#/web/components/terminal/terminal-write-failure-feedback.ts'
import { t } from 'i18next'
import { toast } from 'sonner'
import type {
  TerminalDescriptor,
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

interface PendingResize {
  cols: number
  rows: number
  startEpoch: number
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
}

type GeometryMutationPhase = 'idle' | 'awaiting-attach' | 'awaiting-replay' | 'attached'

export class TerminalSession {
  descriptor: TerminalDescriptor
  private readonly notify: TerminalNotify
  private readonly writeFailureReporter: TerminalWriteFailureReporter
  private readonly runtime = new TerminalSessionRuntime()
  private readonly view: TerminalSessionView
  // Authority gate owns the "am I the controller?" cache and the
  // auto-promote-on-write path. The gate is constructed lazily so
  // the runtime/client dependency wiring stays inside the methods
  // that need it; this also keeps the gate from outliving the
  // session when the projection disposes us.
  private authorityGate: TerminalAuthorityGate | null = null
  private startEpoch = 0
  private geometryAbortController: AbortController | null = null
  private resizeFlushScheduled = false
  private geometryMutationPhase: GeometryMutationPhase = 'idle'
  private outputFlushFrame: number | null = null
  private readonly renderQueue: TerminalRenderQueue

  private pendingResize: PendingResize | null = null
  private pendingOutput: PendingOutputWrite[] = []
  private pendingWriteBuffer = ''
  private inputFlushScheduled = false
  private externalCommandGateTerminalRuntimeSessionId: string | null = null
  private hasObservedOutputForExternalCommandGate = false
  private queuedExternalCommandInput = ''
  // Snapshot presence is explicit: null means no recovery frame was supplied,
  // while an empty string is an authoritative blank screen that must reset a
  // previous generation's xterm.
  private hydratedSnapshot: { snapshot: string | null; snapshotSeq: number; outputEra: number } = {
    snapshot: null,
    snapshotSeq: 0,
    outputEra: 0,
  }
  private stagedHydrationInput: TerminalSessionHydrationInput | null = null
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
      onSearchResult: (event) => this.updateSearchResult(event),
      onProgress: (state, value) => this.updateProgress(state, value),
      onOpenExternalLink: (uri) => this.openExternalLink(uri),
    })
    this.renderQueue = new TerminalRenderQueue({
      isCurrentTerm: (term) => !this.disposed && this.view.currentTerminal() === term,
      isCheckpointRendered: (checkpoint) => this.isCheckpointRendered(checkpoint),
      markOutputRendered: (checkpoint) => this.markOutputRendered(checkpoint),
    })
  }

  updateDescriptor(descriptor: TerminalDescriptor): void {
    this.descriptor = descriptor
  }

  attach(host: HTMLElement): void {
    if (this.disposed) return
    this.view.attach(host)
    if (this.shouldStartAttachedSession()) {
      if (this.view.currentTerminal()) {
        this.view.fitSoon()
      } else {
        this.start()
      }
    }
  }

  focus(): void {
    if (this.disposed) return
    this.view.focus()
  }

  private shouldStartAttachedSession(): boolean {
    if (this.runtime.isController()) return true
    const phase = this.runtime.phase()
    return (phase === 'opening' || phase === 'open') && this.runtime.clientRole() === 'unowned'
  }

  resynchronizeConnectedView(): void {
    if (this.disposed || !this.view.isConnected()) return
    if (!this.shouldStartAttachedSession()) return
    if (this.view.currentTerminal()) this.destroyActiveView()
    this.start()
  }

  detach(host: HTMLElement): void {
    this.clearTerminalFocusIfOwned()
    if (this.view.detach(host) && this.destroyActiveView()) this.notify('metadata')
  }

  restart(): void {
    if (this.disposed) return
    const { changed } = this.runtime.prepareRestart()
    this.destroyActiveView()
    if (changed) this.notify('metadata')
    this.start()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.geometryAbortController?.abort()
    this.geometryAbortController = null
    this.clearTerminalFocusIfOwned()
    this.view.blurIfFocused()
    this.runtime.disposeTerminalRuntimeSessionIds()
    this.destroyActiveView()
    this.view.disposeFrame()
  }

  async disposeAndWait(): Promise<void> {
    this.dispose()
  }

  snapshot() {
    return this.runtime.snapshot()
  }

  isTerminalFocusTarget(target: EventTarget | null): boolean {
    return this.view.isTerminalFocusTarget(target)
  }

  isVisible(): boolean {
    return this.view.isVisible()
  }

  writeInput(input: TerminalInput): void {
    if (this.geometryMutationPhase === 'awaiting-attach' || this.geometryMutationPhase === 'awaiting-replay') {
      return
    }
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    if (!terminalRuntimeSessionId || !this.runtime.canSendInput()) return
    if (this.runtime.isReplaying() && isTerminalEmulatorInput(input)) return
    if (this.shouldQueueExternalCommandInput(input, terminalRuntimeSessionId)) {
      this.queueExternalCommandInput(input.data)
      return
    }
    this.pendingWriteBuffer += input.data
    this.scheduleInputFlush()
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
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    if (!terminalRuntimeSessionId || !this.runtime.canSendInput()) return
    const data = this.pendingWriteBuffer
    this.pendingWriteBuffer = ''
    if (!data) return
    // Funnel every write through the AuthorityGate. If we're a
    // viewer (sibling device / sibling tab is currently the
    // controller), the gate fires a takeover round-trip first so the
    // PTY sees our input as the new controller — the user just
    // types and the gate handles the rest. If the takeover fails
    // (session gone, server rejected), we drop the keystroke rather
    // than firing a write the server would reject with
    // `not-controller`. The user gets a toast for every non-silent
    // denial so the keystroke disappearing is observable.
    void this.authority()
      .authorize('write')
      .then((result) => {
        // Post-dispose guard: the gate's takeover round-trip can
        // resolve after `dispose()` ran, in which case the session no
        // longer owns this terminalRuntimeSessionId. Drop the write — the
        // projection's durable-close queue has already taken
        // responsibility for the actual close.
        if (this.disposed || this.runtime.currentTerminalRuntimeSessionId() !== terminalRuntimeSessionId) return
        if (result.kind === 'denied') {
          this.reportGateDenial('write', result.reason, terminalRuntimeSessionId)
          return
        }
        return terminalClient.write({ terminalRuntimeSessionId, data }).then((result) => {
          if (this.disposed || this.runtime.currentTerminalRuntimeSessionId() !== terminalRuntimeSessionId) return
          if (result.status !== 'accepted')
            this.writeFailureReporter.report({
              terminalRuntimeSessionId,
              failure: { kind: 'result', result },
            })
        })
      })
      .catch((err) => {
        if (this.disposed || this.runtime.currentTerminalRuntimeSessionId() !== terminalRuntimeSessionId) return
        this.writeFailureReporter.report({
          terminalRuntimeSessionId,
          failure: { kind: 'error', error: err },
        })
      })
  }

  private flushResize(): void {
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    const terminalRuntimeGeneration = this.runtime.currentTerminalRuntimeGeneration()
    const resize = this.pendingResize
    if (!terminalRuntimeSessionId || terminalRuntimeGeneration === null || !resize) return
    if (
      resize.startEpoch !== this.startEpoch ||
      resize.terminalRuntimeSessionId !== terminalRuntimeSessionId ||
      resize.terminalRuntimeGeneration !== terminalRuntimeGeneration ||
      this.geometryMutationPhase !== 'attached'
    ) {
      this.pendingResize = null
      return
    }
    if (!this.runtime.canSendInput()) return
    this.pendingResize = null
    const { cols, rows } = resize
    const canonicalSize = this.runtime.currentCanonicalSize()
    if (canonicalSize.cols === cols && canonicalSize.rows === rows) return
    // Mirror `flushInput`: resize is also a controller-only action,
    // so it goes through the gate. Without this a viewer would
    // call `terminalClient.resize` directly, the server would reject
    // with `not-controller`, and the user would see a stale
    // geometry with no feedback. The gate's auto-promote path also
    // gives the resize a chance to succeed via takeover.
    void this.authority()
      .authorize('resize')
      .then((result) => {
        // Post-dispose guard: see `flushInput` for the same
        // race. Without this, a resize queued before `dispose()`
        // could land on a torn-down session's terminalRuntimeSessionId and the
        // server would echo the resize back to whichever sibling
        // tab is now the controller.
        if (
          this.disposed ||
          this.startEpoch !== resize.startEpoch ||
          this.geometryMutationPhase !== 'attached' ||
          this.runtime.currentTerminalRuntimeSessionId() !== terminalRuntimeSessionId
        )
          return
        if (result.kind === 'denied') {
          this.reportGateDenial('resize', result.reason, terminalRuntimeSessionId)
          return
        }
        return terminalClient.resize({
          terminalRuntimeSessionId,
          terminalRuntimeGeneration,
          cols,
          rows,
        }).then((ok) => {
          if (
            ok &&
            this.startEpoch === resize.startEpoch &&
            this.geometryMutationPhase === 'attached' &&
            this.runtime.currentTerminalRuntimeSessionId() === terminalRuntimeSessionId &&
            this.runtime.currentTerminalRuntimeGeneration() === terminalRuntimeGeneration
          )
            this.runtime.acknowledgeResize(cols, rows)
        })
      })
      .catch((err) => {
        // Resize rejection leaves the view stuck at the old geometry —
        // surface the failure so ops can correlate with server-side
        // validation rejections (size out of range, lost controller, etc.).
        terminalLog.warn('resize failed for session', { terminalRuntimeSessionId, cols, rows, err })
      })
  }

  /**
   * Map a structured gate denial to a toast. Per the AGENTS.md i18n
   * rule, the key is read from the typed `WRITE_BLOCKED_KEY_BY_REASON`
   * map rather than concatenated inline. `session-closed` is intentionally
   * silent (the session is gone, no need to nag) so the lookup is
   * `null` in that case.
   */
  private reportGateDenial(
    action: 'write' | 'resize' | 'takeover',
    reason: AuthorizationDenialReason,
    terminalRuntimeSessionId: string,
  ): void {
    terminalLog.warn(`${action} denied by authority gate`, { terminalRuntimeSessionId, reason })
    const key = WRITE_BLOCKED_KEY_BY_REASON[reason]
    if (!key) return
    toast.warning(t(key))
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

  addressableRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.runtime.addressableRuntimeBinding()
  }

  classifyRuntimeBinding(binding: TerminalRuntimeBinding): TerminalRuntimeBindingClassification {
    return this.runtime.classifyRuntimeBinding(binding)
  }

  /**
   * Lazy accessor for the per-session AuthorityGate. The gate is
   * the single source of truth for write-side promotion: xterm
   * onData, paste, drop file, and the 接管 button all funnel
   * through it. Constructed on first access so the client/runtime
   * dependencies stay inside the gate's closure.
   */
  authority(): TerminalAuthorityGate {
    if (!this.authorityGate) {
      this.authorityGate = createXtermAuthorityGate({
        bridge: terminalClient,
        getTerminalRuntimeSessionId: () => this.runtime.currentTerminalRuntimeSessionId(),
        resolveSize: async () => {
          // Prefer the live xterm size — the takeover round-trip
          // resizes the PTY to match the new controller's geometry.
          const term = this.view.currentTerminal()
          if (term) return { cols: term.cols, rows: term.rows }
          // Before the real xterm view exists, the server's canonical
          // size is the only stable source. Once the view is open,
          // xterm's own cols/rows above become authoritative.
          return this.runtime.currentCanonicalSize()
        },
        isSessionAlive: (terminalRuntimeSessionId) =>
          !this.disposed && this.runtime.currentTerminalRuntimeSessionId() === terminalRuntimeSessionId,
        onPromoted: (result) => {
          // Mirror the runtime's `applyTakeover` so the new
          // controller's view (cols/rows/phase) is applied
          // synchronously. The realtime identity event that
          // follows is idempotent.
          if (result.ok) this.runtime.applyTakeover(result)
        },
      })
    }
    return this.authorityGate
  }

  hydrate(input: TerminalSessionHydrationInput, source: TerminalAuthoritativeHydrationSource = 'snapshot'): void {
    const previousTerminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    const hydration = this.runtime.hydrateRepoSession(
      {
        terminalRuntimeSessionId: input.terminalRuntimeSessionId,
        terminalRuntimeGeneration: input.terminalRuntimeGeneration,
        phase: input.phase,
        message: input.message,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle ?? null,
        role: input.role,
        controllerStatus: input.controllerStatus,
        canonicalCols: input.canonicalCols,
        canonicalRows: input.canonicalRows,
      },
      source,
    )
    if (hydration.disposition === 'staged') {
      if (hydration.candidateAccepted) this.stagedHydrationInput = input
      if (hydration.activationPending) this.notify('metadata')
      return
    }
    if (hydration.disposition === 'ignored') return
    this.stagedHydrationInput = null
    this.applyHydrationInput(input, hydration.changed, previousTerminalRuntimeSessionId)
  }

  private applyHydrationInput(
    input: TerminalSessionHydrationInput,
    changed: boolean,
    previousTerminalRuntimeSessionId: string | null,
    forceSnapshot = false,
    notifyChange = true,
  ): void {
    this.hydratedSnapshot = {
      snapshot: input.snapshot,
      snapshotSeq: input.snapshotSeq,
      outputEra: input.outputEra,
    }
    this.syncExternalCommandGate(
      input.terminalRuntimeSessionId,
      terminalSnapshotHasOutput(input.snapshot, input.snapshotSeq),
    )
    // Keep the write-side authority cache aligned with hydration.
    if (changed) this.authority().setRole(input.role)
    if (changed && input.phase === 'open' && input.role === 'unowned' && this.view.isConnected()) {
      this.start()
    }
    if (
      forceSnapshot
        ? this.view.currentTerminal() !== null && input.snapshot !== null
        : this.shouldApplyHydratedSnapshotToActiveView(previousTerminalRuntimeSessionId)
    )
      this.applyHydratedSnapshotToActiveView()
    if (changed && notifyChange) this.notify('metadata')
  }

  pendingAuthoritativeRuntimeBinding(): TerminalRuntimeBinding | null {
    return this.runtime.pendingAuthoritativeRuntimeBinding()
  }

  commitPendingAuthoritativeHydration(binding: TerminalRuntimeBinding): boolean {
    const input = this.stagedHydrationInput
    if (
      !input ||
      input.terminalRuntimeSessionId !== binding.terminalRuntimeSessionId ||
      input.terminalRuntimeGeneration !== binding.terminalRuntimeGeneration
    ) {
      return false
    }
    const committed = this.runtime.commitPendingAuthoritativeHydration(binding)
    if (!committed.accepted) return false
    this.stagedHydrationInput = null
    this.applyHydrationInput(input, committed.changed, null, true, false)
    return true
  }

  private applySettledStagedHydration(_changed: boolean): void {
    if (!this.stagedHydrationInput) return
    this.notify('metadata')
  }

  handleOutput(event: TerminalOutputEvent): void {
    if (this.isOutputAlreadyRendered(event)) return
    const result = this.runtime.handleOutput(event)
    if (result.changed) this.notify('metadata')
    if (result.output && this.runtime.isController()) {
      this.queueOutput(result.output, this.checkpointFromOutputEvent(event))
      this.markExternalCommandGateOutputObserved(event.terminalRuntimeSessionId)
    }
  }

  handleIdentity(event: TerminalIdentityViewModel): void {
    // Identity is the only signal the teardown decision uses. The
    // pre-event role (`wasRole`) is sampled before `handleIdentity`
    // mutates the state so a controller→viewer transition is
    // detected even if the next identity event arrives immediately.
    // The split from lifecycle (`handleLifecycle`) means a
    // transitional phase update can never look like a role change
    // here — the type-level boundary at `applyIdentity` enforces it.
    const wasRole = this.runtime.clientRole()
    const changed = this.runtime.handleIdentity(event)
    if (changed) {
      const newRole = this.runtime.clientRole()
      const isControllerNow = this.runtime.isController()
      const isUnowned = this.runtime.phase() === 'open' && newRole === 'unowned'
      // Sync the gate's role cache. Pass `newRole` through directly
      // (not the boolean `isControllerNow` collapsed form) so the
      // gate can distinguish 'unowned' from 'viewer' — the gate
      // returns `denied: session-closed` for unowned and triggers an
      // auto-promote for viewer.
      this.authority().setRole(newRole)
      // Note: the takeover-pending flag is owned by the takeover
      // round-trip itself (success clears it inline, failure clears
      // it via `clearTakeoverPendingWithNotify`). Clearing it here
      // would race with an in-flight takeover and turn the banner
      // off the moment the server's identity confirmation arrives,
      // before the round-trip has had a chance to resolve.
      if (wasRole === 'controller' && newRole !== 'controller') {
        if (this.view.currentTerminal()) {
          this.destroyActiveView({ preserveTransientState: true })
        }
        if (isUnowned && this.view.isConnected()) {
          this.start()
        }
      } else if (wasRole !== 'controller' && isControllerNow) {
        // Bug E: a viewer → controller transition must always
        // notify, even when the xterm view is already mounted.
        // The previous gate (`!this.view.currentTerminal()`) only
        // repainted on first start; for the cross-browser takeover
        // case the view is mounted (the tab has been a viewer) and
        // the role banner / input-readiness hint has to refresh.
        // The `start()` path is also entered even with an existing
        // view, so any role-driven render diff lands on the next
        // paint via the metadata notify below.
        if (this.view.isConnected()) this.start()
      } else if (wasRole === 'viewer' && newRole === 'unowned' && this.view.isConnected()) {
        // A mounted viewer session became unowned: the previous PTY
        // controller released the session. Auto-attach as the new
        // controller so the user does not have to click into the
        // tab. This branch
        // is independent of the controller→viewer transition above
        // because the xterm is still alive in viewer mode. Tear
        // it down first so the new start() can re-open xterm with
        // the new controller's size.
        if (this.view.currentTerminal()) {
          this.destroyActiveView({ preserveTransientState: true })
        }
        this.start()
      }
    }
    if (changed) {
      this.notify('metadata')
    }
  }

  handleLifecycle(event: TerminalLifecycleViewModel): void {
    // Lifecycle updates never touch the xterm. They are pure state
    // mutations: phase, message, takeover-pending. The teardown
    // decision is gated by `handleIdentity`; a phase-only change
    // is rendered into the snapshot (and only the snapshot) so
    // the user sees the new phase banner without losing the
    // existing xterm.
    const changed = this.runtime.handleLifecycle(event)
    if (!changed) return
    this.notify('metadata')
  }

  handleServerTitle(canonicalTitle: string | null): void {
    if (this.runtime.setCanonicalTitle(canonicalTitle)) this.notify('metadata')
  }

  handleExit(event: TerminalExitEvent): boolean {
    if (!this.runtime.handleExit(event)) return false
    this.flushOutput(event.terminalRuntimeSessionId)
    this.clearExternalCommandGate()
    this.clearTerminalFocusIfOwned()
    this.view.blurIfFocused()
    return true
  }

  async takeover(): Promise<boolean> {
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    if (!terminalRuntimeSessionId) return false
    // Capture the role BEFORE the gate calls applyTakeover — the
    // post-takeover check below needs to fire `ensureControllerViewStarted`
    // when the caller was a viewer and is now a controller. Reading
    // `wasController` after the gate returns would always be `true`
    // and the view-start branch would be skipped.
    const wasController = this.runtime.isController()
    if (this.runtime.setTakeoverPending(true)) this.notify('metadata')
    // The takeover response is the authoritative handshake for the
    // new controller's view (see TerminalTakeoverResult in
    // src/shared/terminal-types.ts). We delegate the round-trip to
    // the AuthorityGate — the same path the auto-promote-on-write
    // uses — so there is one implementation of "promote me to
    // controller" for both the button and the keyboard. The gate
    // owns the diagnostic log for the denied case (single
    // emission point for all deny paths); this layer only flips
    // the pending flag.
    const result = await this.authority().takeover()
    const ok = result.kind === 'allowed'
    if (ok) {
      this.runtime.clearTakeoverPending()
      this.notify('metadata')
      // `applyTakeover` was called inside the gate's onPromoted
      // hook, so the runtime already reflects the new role.
      if (!wasController && this.runtime.isController()) this.ensureControllerViewStarted()
    } else {
      this.clearTakeoverPendingWithNotify()
      // Mirror the write/resize paths: surface the structured
      // denial reason to the user so the silent failure is
      // observable. Without this, the 接管 button click appears
      // to do nothing on a session-unknown or client-offline
      // condition.
      if (terminalRuntimeSessionId) this.reportGateDenial('takeover', result.reason, terminalRuntimeSessionId)
    }
    return ok
  }

  private clearTakeoverPendingWithNotify(): void {
    if (this.runtime.isTakeoverPending()) {
      if (this.runtime.setTakeoverPending(false)) this.notify('metadata')
    }
  }

  private ensureControllerViewStarted(): void {
    if (!this.runtime.isController()) return
    if (this.view.isConnected()) this.start()
  }

  private start(): void {
    if (this.disposed || this.view.currentTerminal() || !this.view.isConnected()) return
    const epoch = (this.startEpoch += 1)
    let attempt: TerminalRuntimeAttemptToken | null
    if (this.runtime.phase() === 'restarting') {
      attempt = this.runtime.currentAttemptToken()
    } else {
      const started = this.runtime.startAttaching()
      attempt = started.attempt
      if (started.changed) this.notify('metadata')
    }
    if (!attempt) return
    void this.startAsync(epoch, attempt)
  }

  private async startAsync(epoch: number, attempt: TerminalRuntimeAttemptToken): Promise<void> {
    let preloadReplayGeneration: number | null = null
    try {
      const opened = await this.openPhase(epoch, attempt)
      const { term } = opened
      preloadReplayGeneration = opened.preloadReplayGeneration
      const result = await this.ipcPhase(epoch, attempt, term)
      if (result.phase === 'error') {
        // The attach failed. Drop the replay window the preload
        // started so the boundary and captured events don't leak
        // into the next start.
        if (preloadReplayGeneration !== null) this.runtime.drainReplay(preloadReplayGeneration)
        const committed = this.runtime.commitAttachResult(attempt, result)
        if (!committed.accepted) throw new StartCancelledError()
        if (committed.resolution === 'staged') {
          this.applySettledStagedHydration(committed.changed)
          throw new StartCancelledError()
        }
        this.stagedHydrationInput = null
        // Sync the gate so writes/resizes that race the next identity
        // event use the correct role. The attach response is
        // authoritative for the new terminalRuntimeSessionId, so a successful
        // attach always lands here before any keystroke.
        this.authority().setRole(result.role)
        this.destroyActiveView()
        if (committed.changed) this.notify('metadata')
        this.notifyAttachProjectionRevision(result)
        return
      }
      this.geometryMutationPhase = 'awaiting-replay'
      if (result.frame === 'stream' && preloadReplayGeneration !== null) {
        // This is a protocol invariant failure, not a state to reconcile:
        // stream means no history existed, while a non-empty preload means
        // this view was given recovery history for the same binding.
        this.runtime.drainReplay(preloadReplayGeneration)
        preloadReplayGeneration = null
        throw new Error('terminal stream frame conflicts with recovery preload')
      }
      const metadataChanged =
        result.frame === 'snapshot'
          ? await this.replayPhase(epoch, attempt, term, result)
          : this.streamPhase(epoch, attempt, term, result)
      this.finalizePhase(epoch, term, metadataChanged)
      // xterm batches refreshes from fit and replay through its own rAF
      // debouncer. Keep the frame hidden until that render has run and a
      // browser paint opportunity has passed.
      await waitForTerminalLayout()
      this.assertCurrentStart(epoch, term)
      if (!this.view.reveal(term)) throw new StartCancelledError()
      this.geometryMutationPhase = 'attached'
      this.queueResize(term.cols, term.rows)
    } catch (err) {
      if (err instanceof StartCancelledError) {
        // A newer start has superseded this one. Drop the replay
        // window the cancelled preload opened, so the next start's
        // beginReplay doesn't inherit events captured against the
        // cancelled term.
        if (preloadReplayGeneration !== null) this.runtime.drainReplay(preloadReplayGeneration)
        return
      }
      if (!this.isCurrentStartEpoch(epoch)) return
      const failed = this.runtime.failStartAttempt(attempt, err instanceof Error ? err.message : String(err))
      if (!failed.accepted) return
      if (failed.resolution === 'staged') {
        this.applySettledStagedHydration(failed.changed)
        return
      }
      this.destroyActiveView()
      if (failed.changed) this.notify('metadata')
    }
  }

  private async openPhase(
    epoch: number,
    attempt: TerminalRuntimeAttemptToken,
  ): Promise<{ term: XTermTerminal; preloadReplayGeneration: number | null }> {
    let preloadReplayGeneration: number | null = null
    if (this.disposed || this.startEpoch !== epoch || this.view.currentTerminal()) throw new StartCancelledError()
    try {
      await preloadTerminalFont()
      // The preload await can yield long enough for the session to be disposed
      // (React unmount, user navigation). Without this guard the orchestrator
      // would proceed to waitForMeasurableHost with a detached host, leaking a
      // ResizeObserver and hanging the promise indefinitely.
      if (this.disposed || this.startEpoch !== epoch) throw new StartCancelledError()
      // The orchestrator owns the geometry wait. The view never falls back to
      // a default — if the host never becomes measurable, this attach fails
      // and the user can retry by re-selecting the terminal. See
      // docs/terminal.md "Geometry and layout model".
      const geometryAbortController = new AbortController()
      this.geometryAbortController?.abort()
      this.geometryAbortController = geometryAbortController
      try {
        await waitForMeasurableHost(this.view.measurableHost(), {
          signal: geometryAbortController.signal,
          measure: measureHostAsOpenable,
        })
      } catch (err) {
        if (err instanceof TerminalHostNotMeasurableError || geometryAbortController.signal.aborted) {
          terminalLog.warn('terminal host did not become measurable; failing attach', { err })
          // The wait may have been aborted by a newer start() or by dispose().
          // In that case a fresh attach is already in flight and we must not
          // tear its transient state down. Tear down only if our starting epoch
          // is still current.
          if (this.isCurrentStartEpoch(epoch)) {
            const failed = this.runtime.failStartAttempt(attempt, 'error.terminal-host-not-measurable')
            if (failed.resolution === 'staged') this.applySettledStagedHydration(failed.changed)
            else {
              this.destroyActiveView()
              if (failed.accepted && failed.changed) this.notify('metadata')
            }
          }
          throw new StartCancelledError()
        }
        throw err
      }
      if (this.geometryAbortController === geometryAbortController) this.geometryAbortController = null
      this.geometryMutationPhase = 'awaiting-attach'
      const term = this.view.openTerminal({ cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS }, (input) =>
        this.writeInput(input),
      )
      await waitForTerminalLayout()
      this.assertCurrentStart(epoch, term)
      if (!this.view.fitNow()) throw new TerminalHostNotMeasurableError('terminal host became unmeasurable')
      // fitNow queues a full xterm refresh. Its renderer is asynchronous, so
      // attach must not overtake the fitted frame's render callback.
      await waitForTerminalLayout()
      this.assertCurrentStart(epoch, term)
      preloadReplayGeneration = await this.preloadHydratedSnapshot(epoch, term)
      this.assertCurrentStart(epoch, term)
      return { term, preloadReplayGeneration }
    } catch (err) {
      if (err instanceof StartCancelledError && preloadReplayGeneration !== null) {
        this.runtime.drainReplay(preloadReplayGeneration)
      }
      throw err
    }
  }

  private async ipcPhase(
    epoch: number,
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
  ): Promise<TerminalStartResultWithController> {
    const restart = attempt.operation === 'restart'
    const terminalRuntimeSessionId = restart
      ? this.runtime.restartingTerminalRuntimeSessionId()
      : this.runtime.currentTerminalRuntimeSessionId()
    if (!terminalRuntimeSessionId) {
      this.destroyActiveView()
      const failed = this.runtime.failStartAttempt(attempt, 'error.invalid-arguments')
      if (failed.accepted && failed.changed) this.notify('metadata')
      throw new StartCancelledError()
    }
    const result = restart
      ? await terminalClient.restart(this.terminalRestartInput(terminalRuntimeSessionId, term))
      : await terminalClient.attach(this.terminalAttachInput(terminalRuntimeSessionId, term))
    if (this.disposed || this.startEpoch !== epoch || this.view.currentTerminal() !== term) {
      if (this.disposed && !result.ok) this.runtime.takePendingRestartTerminalRuntimeSessionIdForClose()
      throw new StartCancelledError()
    }
    if (!result.ok) {
      const failed = this.runtime.failStartAttempt(attempt, result.message)
      if (failed.resolution === 'staged') this.applySettledStagedHydration(failed.changed)
      else {
        this.destroyActiveView()
        if (failed.accepted && failed.changed) this.notify('metadata')
      }
      throw new StartCancelledError()
    }
    return this.withLocalController(result)
  }

  private async replayPhase(
    epoch: number,
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
    result: Extract<TerminalStartResultWithController, { frame: 'snapshot' }>,
  ): Promise<boolean> {
    const metadataChanged = this.commitAttachFrame(attempt, term, result)
    await this.replayActiveView(epoch, term, result.snapshot, {
      terminalRuntimeSessionId: result.terminalRuntimeSessionId,
      outputEra: result.outputEra,
      seq: result.snapshotSeq,
    })
    this.assertCurrentStart(epoch, term)
    this.notifyAttachProjectionRevision(result)
    return metadataChanged
  }

  private streamPhase(
    epoch: number,
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
    result: Extract<TerminalStartResultWithController, { frame: 'stream' }>,
  ): boolean {
    const metadataChanged = this.commitAttachFrame(attempt, term, result)
    this.assertCurrentStart(epoch, term)
    this.notifyAttachProjectionRevision(result)
    return metadataChanged
  }

  private notifyAttachProjectionRevision(result: TerminalStartResultWithController): void {
    if (result.terminalProjectionEffect.kind === 'delta') {
      this.notify('projection-delta-revision', result.terminalProjectionEffect.revision)
    }
  }

  private commitAttachFrame(
    attempt: TerminalRuntimeAttemptToken,
    term: XTermTerminal,
    result: TerminalStartResultWithController,
  ): boolean {
    const committed = this.runtime.commitAttachResult(attempt, result)
    if (!committed.accepted) throw new StartCancelledError()
    if (committed.resolution === 'staged') {
      this.applySettledStagedHydration(committed.changed)
      throw new StartCancelledError()
    }
    this.stagedHydrationInput = null
    this.syncExternalCommandGate(
      result.terminalRuntimeSessionId,
      result.frame === 'snapshot' && terminalSnapshotHasOutput(result.snapshot, result.snapshotSeq),
    )
    // Sync the gate. Without this, a controller→unowned→recreate
    // cycle leaves the gate at 'viewer' even though the runtime
    // already reflects 'controller', and the next write would
    // spuriously trigger a takeover round-trip to a server that
    // already considers us the controller.
    this.authority().setRole(result.role)
    if (!this.runtime.isController()) {
      this.applyCanonicalSizeToView()
    } else {
      const canonicalSize = this.runtime.currentCanonicalSize()
      if (term.cols !== canonicalSize.cols || term.rows !== canonicalSize.rows) {
        this.queueResize(term.cols, term.rows)
      }
    }
    return committed.changed
  }

  private finalizePhase(epoch: number, term: XTermTerminal, metadataChanged: boolean): void {
    this.assertCurrentStart(epoch, term)
    if (metadataChanged) this.notify('metadata')
  }

  private assertCurrentStart(epoch: number, term: XTermTerminal): void {
    if (this.disposed || this.startEpoch !== epoch || this.view.currentTerminal() !== term) {
      throw new StartCancelledError()
    }
  }

  private terminalAttachInput(terminalRuntimeSessionId: string, term: XTermTerminal): TerminalAttachInput {
    return {
      terminalRuntimeSessionId,
      cols: term.cols,
      rows: term.rows,
    }
  }

  private terminalRestartInput(terminalRuntimeSessionId: string, term: XTermTerminal): TerminalRestartInput {
    return {
      terminalRuntimeSessionId,
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

  private async preloadHydratedSnapshot(epoch: number, term: XTermTerminal): Promise<number | null> {
    const hydratedSnapshot = this.hydratedSnapshot
    if (hydratedSnapshot.snapshot === null || !this.isCurrentStart(epoch, term)) return null
    // Open the replay window — see state.beginReplay for the preload+post-attach contract.
    const replayCheckpoint = this.checkpointFromHydratedSnapshot(hydratedSnapshot)
    const replayGeneration = this.runtime.beginReplay(replayCheckpoint)
    try {
      const applied = await this.enqueueRenderReplace(term, hydratedSnapshot.snapshot, replayCheckpoint)
      if (!applied) {
        this.runtime.drainReplay(replayGeneration)
        return null
      }
      // Post-await dispose guard: `termWrite` may have resolved
      // after `dispose()` ran (the session is no longer the current
      // controller of this terminalRuntimeSessionId, the term is destroyed, and any
      // `term.write` callback would land on a freed term and throw
      // an unhandled-rejection). Drop the replay window before
      // letting the callback path touch anything.
      if (this.disposed) {
        this.runtime.drainReplay(replayGeneration)
        return null
      }
      const stillCurrent = this.isCurrentStart(epoch, term)
      // Identity check: a concurrent hydrate() between termWrite start
      // and resolve may have already replaced this.hydratedSnapshot
      // with a fresher value. Clearing in that case would discard it;
      // we leave the new value for its own write path to clear.
      if (stillCurrent && this.hydratedSnapshot === hydratedSnapshot) {
        this.hydratedSnapshot = { snapshot: null, snapshotSeq: 0, outputEra: 0 }
      }
      if (!stillCurrent) {
        this.runtime.drainReplay(replayGeneration)
        return null
      }
      return replayGeneration
    } catch (err) {
      // Term write failed — drop the replay window so the boundary
      // and buffer don't leak into the next start.
      this.runtime.drainReplay(replayGeneration)
      throw err
    }
  }

  private applyHydratedSnapshotToActiveView(): void {
    const term = this.view.currentTerminal()
    const hydratedSnapshot = this.hydratedSnapshot
    if (!term || hydratedSnapshot.snapshot === null) return
    this.clearPendingOutput()
    const replayCheckpoint = this.checkpointFromHydratedSnapshot(hydratedSnapshot)
    const replayGeneration = this.runtime.beginReplay(replayCheckpoint)
    try {
      void this.enqueueRenderReplace(term, hydratedSnapshot.snapshot, replayCheckpoint)
        .then((applied) => {
          if (!applied) {
            this.runtime.drainReplay(replayGeneration)
            return
          }
          // Post-dispose guard: see `preloadHydratedSnapshot` for
          // the same race. The queue callback is async; if
          // `dispose()` ran between enqueue and completion, the term
          // is destroyed and replay state must be discarded.
          if (this.disposed) {
            this.runtime.drainReplay(replayGeneration)
            return
          }
          this.finishActiveHydratedSnapshotReplay(term, hydratedSnapshot, replayCheckpoint, replayGeneration)
        })
        .catch((err) => {
          this.runtime.drainReplay(replayGeneration)
          terminalLog.warn('failed to apply hydrated terminal snapshot', { err })
        })
    } catch (err) {
      this.runtime.drainReplay(replayGeneration)
      throw err
    }
  }

  private shouldApplyHydratedSnapshotToActiveView(previousTerminalRuntimeSessionId: string | null): boolean {
    const term = this.view.currentTerminal()
    if (!term) return false
    if (this.hydratedSnapshot.snapshot === null) return false
    const currentTerminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    if (!currentTerminalRuntimeSessionId) return false
    if (previousTerminalRuntimeSessionId && previousTerminalRuntimeSessionId !== currentTerminalRuntimeSessionId) {
      return true
    }
    return !this.isCheckpointRendered(this.checkpointFromHydratedSnapshot(this.hydratedSnapshot))
  }

  private finishActiveHydratedSnapshotReplay(
    term: XTermTerminal,
    hydratedSnapshot: { snapshot: string | null; snapshotSeq: number; outputEra: number },
    replayCheckpoint: RenderedOutputCheckpoint,
    replayGeneration: number,
  ): void {
    if (this.view.currentTerminal() === term) {
      this.markOutputRendered(replayCheckpoint)
      for (const event of this.runtime.finishReplay(replayGeneration)) {
        this.queueOutput(event.data, this.checkpointFromOutputEvent(event))
      }
    } else {
      this.runtime.drainReplay(replayGeneration)
    }
    // Identity check: see preloadHydratedSnapshot. A concurrent
    // hydrate() may have replaced this.hydratedSnapshot since we
    // captured the local reference; only clear if it still points
    // at the snapshot we just wrote.
    if (this.hydratedSnapshot === hydratedSnapshot) {
      this.hydratedSnapshot = { snapshot: null, snapshotSeq: 0, outputEra: 0 }
    }
  }

  private queueResize(cols: number, rows: number): void {
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    const terminalRuntimeGeneration = this.runtime.currentTerminalRuntimeGeneration()
    if (!terminalRuntimeSessionId || terminalRuntimeGeneration === null || !this.runtime.canSendInput()) return
    if (this.geometryMutationPhase !== 'attached') return
    const canonicalSize = this.runtime.currentCanonicalSize()
    if (canonicalSize.cols === cols && canonicalSize.rows === rows && !this.pendingResize) return
    this.pendingResize = {
      cols,
      rows,
      startEpoch: this.startEpoch,
      terminalRuntimeSessionId,
      terminalRuntimeGeneration,
    }
    if (this.resizeFlushScheduled) return
    this.resizeFlushScheduled = true
    queueMicrotask(() => {
      this.resizeFlushScheduled = false
      this.flushResize()
    })
  }

  private applyCanonicalSizeToView(): void {
    const { cols, rows } = this.runtime.currentCanonicalSize()
    if (cols > 0 && rows > 0) this.view.resizeTo(cols, rows)
  }

  private cancelResizeFlush(): void {
    this.resizeFlushScheduled = false
  }

  private queueOutput(data: string, checkpoint: RenderedOutputCheckpoint): void {
    if (!this.view.currentTerminal()) return
    this.pendingOutput.push({ data, checkpoint })
    if (this.outputFlushFrame !== null) return
    this.outputFlushFrame = requestAnimationFrame(() => {
      this.outputFlushFrame = null
      this.flushOutput()
    })
  }

  private flushOutput(terminalRuntimeSessionId: string | null = this.runtime.currentTerminalRuntimeSessionId()): void {
    if (this.outputFlushFrame !== null) {
      cancelScheduledAnimationFrame(this.outputFlushFrame)
      this.outputFlushFrame = null
    }
    if (!this.pendingOutput.length) return
    const pendingOutput = this.pendingOutput
    this.pendingOutput = []
    if (!terminalRuntimeSessionId) return
    const currentOutput = pendingOutput.filter(
      (entry) => entry.checkpoint.terminalRuntimeSessionId === terminalRuntimeSessionId,
    )
    if (!currentOutput.length) return
    const output = currentOutput.map((entry) => entry.data).join('')
    const checkpoint = latestCheckpoint(currentOutput.map((entry) => entry.checkpoint))
    const term = this.view.currentTerminal()
    if (!term || !checkpoint) return
    this.enqueueRenderAppend(term, output, checkpoint)
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
    this.clearPendingOutput()
    return this.renderQueue.replace(term, data, checkpoint)
  }

  private enqueueRenderAppend(term: XTermTerminal, data: string, checkpoint: RenderedOutputCheckpoint): void {
    this.renderQueue.append(term, data, checkpoint)
  }

  private clearRenderQueue(): void {
    this.renderQueue.clear()
  }

  private isOutputAlreadyRendered(event: TerminalOutputEvent): boolean {
    const checkpoint = this.renderedOutputCheckpoint
    if (!checkpoint || checkpoint.terminalRuntimeSessionId !== event.terminalRuntimeSessionId) return false
    if (event.outputEra !== checkpoint.outputEra) return event.outputEra < checkpoint.outputEra
    return event.seq <= checkpoint.seq
  }

  private isCheckpointRendered(checkpoint: RenderedOutputCheckpoint): boolean {
    const current = this.renderedOutputCheckpoint
    if (!current || current.terminalRuntimeSessionId !== checkpoint.terminalRuntimeSessionId) return false
    if (checkpoint.outputEra !== current.outputEra) return checkpoint.outputEra < current.outputEra
    return checkpoint.seq <= current.seq
  }

  private markOutputRendered(checkpoint: RenderedOutputCheckpoint): void {
    if (this.runtime.currentTerminalRuntimeSessionId() !== checkpoint.terminalRuntimeSessionId) return
    const current = this.renderedOutputCheckpoint
    if (!current || current.terminalRuntimeSessionId !== checkpoint.terminalRuntimeSessionId) {
      this.renderedOutputCheckpoint = normalizeRenderedOutputCheckpoint(checkpoint)
      return
    }
    if (checkpoint.outputEra < current.outputEra) return
    if (checkpoint.outputEra > current.outputEra) {
      this.renderedOutputCheckpoint = normalizeRenderedOutputCheckpoint(checkpoint)
      return
    }
    if (checkpoint.seq > current.seq) this.renderedOutputCheckpoint = normalizeRenderedOutputCheckpoint(checkpoint)
  }

  private checkpointFromOutputEvent(event: TerminalOutputEvent): RenderedOutputCheckpoint {
    return {
      terminalRuntimeSessionId: event.terminalRuntimeSessionId,
      outputEra: event.outputEra,
      seq: event.seq,
    }
  }

  private checkpointFromHydratedSnapshot(snapshot: {
    outputEra: number
    snapshotSeq: number
  }): RenderedOutputCheckpoint {
    const terminalRuntimeSessionId = this.runtime.currentTerminalRuntimeSessionId()
    return {
      terminalRuntimeSessionId: terminalRuntimeSessionId ?? '',
      outputEra: snapshot.outputEra,
      seq: snapshot.snapshotSeq,
    }
  }

  private shouldQueueExternalCommandInput(input: TerminalInput, terminalRuntimeSessionId: string): boolean {
    return (
      isExternalCommandInput(input) &&
      this.externalCommandGateTerminalRuntimeSessionId === terminalRuntimeSessionId &&
      !this.hasObservedOutputForExternalCommandGate
    )
  }

  private queueExternalCommandInput(data: string): void {
    if (!data) return
    this.queuedExternalCommandInput += data
  }

  private syncExternalCommandGate(terminalRuntimeSessionId: string, hasObservedOutput: boolean): void {
    if (this.externalCommandGateTerminalRuntimeSessionId !== terminalRuntimeSessionId) {
      this.clearExternalCommandGate()
      this.externalCommandGateTerminalRuntimeSessionId = terminalRuntimeSessionId
    }
    if (hasObservedOutput) this.markExternalCommandGateOutputObserved(terminalRuntimeSessionId)
  }

  private markExternalCommandGateOutputObserved(terminalRuntimeSessionId: string): void {
    if (this.externalCommandGateTerminalRuntimeSessionId !== terminalRuntimeSessionId) return
    if (this.hasObservedOutputForExternalCommandGate) return
    this.hasObservedOutputForExternalCommandGate = true
    this.flushQueuedExternalCommandInput()
  }

  private flushQueuedExternalCommandInput(): void {
    const data = this.queuedExternalCommandInput
    this.queuedExternalCommandInput = ''
    if (!data) return
    this.pendingWriteBuffer += data
    this.scheduleInputFlush()
  }

  private clearExternalCommandGate(): void {
    this.externalCommandGateTerminalRuntimeSessionId = null
    this.hasObservedOutputForExternalCommandGate = false
    this.queuedExternalCommandInput = ''
  }

  private destroyActiveView(options?: { preserveTransientState?: boolean }): boolean {
    this.geometryAbortController?.abort()
    this.geometryAbortController = null
    this.cancelResizeFlush()
    this.clearPendingOutput()
    this.pendingResize = null
    this.geometryMutationPhase = 'idle'
    this.pendingWriteBuffer = ''
    this.inputFlushScheduled = false
    this.clearExternalCommandGate()
    this.startEpoch += 1
    const transientChanged = options?.preserveTransientState ? false : this.runtime.resetTransientState()
    this.view.destroyTerminal()
    return transientChanged
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

  private clearTerminalFocusIfOwned(): void {
    if (this.isTerminalFocusTarget(document.activeElement)) setTerminalFocused(false)
  }
}

function waitForTerminalLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

function measureHostAsOpenable(host: HTMLElement): { cols: number; rows: number } | null {
  const rect = host.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { cols: DEFAULT_TERMINAL_COLS, rows: DEFAULT_TERMINAL_ROWS }
}

function cancelScheduledAnimationFrame(frame: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  else clearTimeout(frame)
}

function terminalSnapshotHasOutput(snapshot: string | null, snapshotSeq: number): boolean {
  return (snapshot !== null && snapshot.length > 0) || snapshotSeq > 0
}

function latestCheckpoint(checkpoints: RenderedOutputCheckpoint[]): RenderedOutputCheckpoint | null {
  return checkpoints.reduce<RenderedOutputCheckpoint | null>((latest, checkpoint) => {
    if (!latest) return checkpoint
    if (checkpoint.terminalRuntimeSessionId !== latest.terminalRuntimeSessionId) return latest
    if (checkpoint.outputEra > latest.outputEra) return checkpoint
    if (checkpoint.outputEra < latest.outputEra) return latest
    return checkpoint.seq > latest.seq ? checkpoint : latest
  }, null)
}

function normalizeRenderedOutputCheckpoint(checkpoint: RenderedOutputCheckpoint): RenderedOutputCheckpoint {
  return {
    terminalRuntimeSessionId: checkpoint.terminalRuntimeSessionId,
    outputEra: normalizeOutputNumber(checkpoint.outputEra),
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
