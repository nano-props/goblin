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
 * Close requests are deduped by ptySessionId and are awaited by later creates
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
  ptySessionId: string
  terminalWorktreeKey: string
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

export class TerminalSessionLifecycleQueues<TBase, TOptions> {
  private readonly pendingCreateByWorktree = new Map<string, PendingTerminalCreate<TBase, TOptions>>()
  private readonly pendingCloseByPtySessionId = new Map<string, PendingTerminalClose>()

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
      return existing.promise
        .catch(() => undefined)
        .then(() => this.enqueueCreate(input))
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
    const existing = this.pendingCloseByPtySessionId.get(input.ptySessionId)
    if (existing) return existing.promise

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    const entry: PendingTerminalClose = { ...input, promise, resolve, reject }
    this.pendingCloseByPtySessionId.set(input.ptySessionId, entry)
    void perform(input).then(
      () => this.settleClose(input.ptySessionId, entry, null),
      (error) => this.settleClose(input.ptySessionId, entry, error),
    )
    return promise
  }

  hasCloses(): boolean {
    return this.pendingCloseByPtySessionId.size > 0
  }

  closesForWorktree(terminalWorktreeKey: string): PendingTerminalClose[] {
    return Array.from(this.pendingCloseByPtySessionId.values()).filter(
      (entry) => entry.terminalWorktreeKey === terminalWorktreeKey,
    )
  }

  rejectAll(error: unknown): void {
    for (const pending of this.pendingCreateByWorktree.values()) pending.reject(error)
    for (const pending of this.pendingCloseByPtySessionId.values()) pending.reject(error)
    this.pendingCreateByWorktree.clear()
    this.pendingCloseByPtySessionId.clear()
  }

  private settleClose(ptySessionId: string, entry: PendingTerminalClose, error: unknown): void {
    if (this.pendingCloseByPtySessionId.get(ptySessionId) !== entry) return
    this.pendingCloseByPtySessionId.delete(ptySessionId)
    if (error === null) entry.resolve()
    else entry.reject(error)
  }
}
