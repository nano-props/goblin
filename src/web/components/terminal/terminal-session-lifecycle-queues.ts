/**
 * Per-worktree lifecycle queues for terminal create/close orchestration.
 *
 * Create requests are serialized by terminal worktree. A second create for the
 * same worktree either dedupes onto the existing promise when
 * `isSameRequest(existing, next)` is true, or re-enqueues itself after the
 * current promise settles when it is a distinct request. Same-request dedupe
 * must therefore resolve to the same terminalSessionId; distinct requests must
 * get their own later create attempt.
 *
 * Close requests are deduped by terminalRuntimeSessionId and are awaited by later creates
 * for the same worktree so a fresh create cannot race an orphan close.
 */
export interface PendingTerminalCreate<TBase, TOptions> {
  base: TBase
  options: TOptions
  promise: Promise<string>
  resolve: (terminalSessionId: string) => void
  reject: (error: unknown) => void
  flushing: boolean
  creating: boolean
}

export interface PendingTerminalClose {
  terminalRuntimeSessionId: string
  terminalWorktreeKey: string
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

export class TerminalSessionLifecycleQueues<TBase, TOptions> {
  private readonly pendingCreateByWorktree = new Map<string, PendingTerminalCreate<TBase, TOptions>>()
  private readonly pendingCloseByTerminalRuntimeSessionId = new Map<string, PendingTerminalClose>()

  enqueueCreate(input: {
    terminalWorktreeKey: string
    base: TBase
    options: TOptions
    isSameRequest: (existing: TOptions, next: TOptions) => boolean
    flush: (terminalWorktreeKey: string) => void
  }): Promise<string> {
    const existing = this.pendingCreateByWorktree.get(input.terminalWorktreeKey)
    if (existing) {
      if (input.isSameRequest(existing.options, input.options)) return existing.promise
      return existing.promise.catch(() => undefined).then(() => this.enqueueCreate(input))
    }
    let resolve!: (terminalSessionId: string) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    this.pendingCreateByWorktree.set(input.terminalWorktreeKey, {
      base: input.base,
      options: input.options,
      promise,
      resolve,
      reject,
      flushing: false,
      creating: false,
    })
    input.flush(input.terminalWorktreeKey)
    return promise
  }

  getCreate(terminalWorktreeKey: string): PendingTerminalCreate<TBase, TOptions> | undefined {
    return this.pendingCreateByWorktree.get(terminalWorktreeKey)
  }

  hasCreate(terminalWorktreeKey: string): boolean {
    return this.pendingCreateByWorktree.has(terminalWorktreeKey)
  }

  deleteCreate(terminalWorktreeKey: string, expected?: PendingTerminalCreate<TBase, TOptions>): boolean {
    if (expected && this.pendingCreateByWorktree.get(terminalWorktreeKey) !== expected) return false
    return this.pendingCreateByWorktree.delete(terminalWorktreeKey)
  }

  enqueueClose(
    input: Omit<PendingTerminalClose, 'promise' | 'resolve' | 'reject'>,
    perform: (input: Omit<PendingTerminalClose, 'promise' | 'resolve' | 'reject'>) => Promise<void>,
  ): Promise<void> {
    const existing = this.pendingCloseByTerminalRuntimeSessionId.get(input.terminalRuntimeSessionId)
    if (existing) return existing.promise

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    const entry: PendingTerminalClose = { ...input, promise, resolve, reject }
    this.pendingCloseByTerminalRuntimeSessionId.set(input.terminalRuntimeSessionId, entry)
    void perform(input).then(
      () => this.settleClose(input.terminalRuntimeSessionId, entry, null),
      (error) => this.settleClose(input.terminalRuntimeSessionId, entry, error),
    )
    return promise
  }

  hasCloses(): boolean {
    return this.pendingCloseByTerminalRuntimeSessionId.size > 0
  }

  closesForWorktree(terminalWorktreeKey: string): PendingTerminalClose[] {
    return Array.from(this.pendingCloseByTerminalRuntimeSessionId.values()).filter(
      (entry) => entry.terminalWorktreeKey === terminalWorktreeKey,
    )
  }

  rejectAll(error: unknown): void {
    for (const pending of this.pendingCreateByWorktree.values()) pending.reject(error)
    for (const pending of this.pendingCloseByTerminalRuntimeSessionId.values()) pending.reject(error)
    this.pendingCreateByWorktree.clear()
    this.pendingCloseByTerminalRuntimeSessionId.clear()
  }

  private settleClose(terminalRuntimeSessionId: string, entry: PendingTerminalClose, error: unknown): void {
    if (this.pendingCloseByTerminalRuntimeSessionId.get(terminalRuntimeSessionId) !== entry) return
    this.pendingCloseByTerminalRuntimeSessionId.delete(terminalRuntimeSessionId)
    if (error === null) entry.resolve()
    else entry.reject(error)
  }
}
