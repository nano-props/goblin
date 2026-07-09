/**
 * Per-worktree lifecycle queues for terminal create/close orchestration.
 *
 * Create requests are serialized by terminal worktree. A second create for the
 * same worktree either dedupes onto an existing active/queued promise when
 * `isSameRequest(existing, next)` is true, or waits in the same visible queue
 * when it is a distinct request. Same-request dedupe must therefore resolve to
 * the same terminalSessionId; distinct requests must get their own later create
 * attempt.
 *
 * Close requests are deduped by terminalRuntimeSessionId and are awaited by later creates
 * for the same worktree so a fresh create cannot race an orphan close.
 */
export interface TerminalCreateQueueEntry<TBase, TOptions> {
  base: TBase
  options: TOptions
  promise: Promise<string>
  resolve: (terminalSessionId: string) => void
  reject: (error: unknown) => void
  flushing: boolean
  creating: boolean
}

export interface TerminalCreateQueueAdmission {
  promise: Promise<string>
  ownsCreate: boolean
}

export interface PendingTerminalClose {
  terminalRuntimeSessionId: string
  terminalWorktreeKey: string
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

export class TerminalSessionLifecycleQueues<TBase, TOptions> {
  private readonly createEntriesByWorktree = new Map<string, TerminalCreateQueueEntry<TBase, TOptions>[]>()
  private readonly pendingCloseByTerminalRuntimeSessionId = new Map<string, PendingTerminalClose>()

  enqueueCreate(input: {
    terminalWorktreeKey: string
    base: TBase
    options: TOptions
    isSameRequest: (existing: TOptions, next: TOptions) => boolean
    flush: (terminalWorktreeKey: string) => void
  }): TerminalCreateQueueAdmission {
    const queue = this.createQueue(input.terminalWorktreeKey)
    const existing = queue.find((entry) => input.isSameRequest(entry.options, input.options))
    if (existing) return { promise: existing.promise, ownsCreate: false }
    let resolve!: (terminalSessionId: string) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<string>((innerResolve, innerReject) => {
      resolve = innerResolve
      reject = innerReject
    })
    const wasEmpty = queue.length === 0
    queue.push({
      base: input.base,
      options: input.options,
      promise,
      resolve,
      reject,
      flushing: false,
      creating: false,
    })
    if (wasEmpty) input.flush(input.terminalWorktreeKey)
    return { promise, ownsCreate: true }
  }

  getCreate(terminalWorktreeKey: string): TerminalCreateQueueEntry<TBase, TOptions> | undefined {
    return this.createEntriesByWorktree.get(terminalWorktreeKey)?.[0]
  }

  hasCreate(terminalWorktreeKey: string): boolean {
    return (this.createEntriesByWorktree.get(terminalWorktreeKey)?.length ?? 0) > 0
  }

  deleteCreate(terminalWorktreeKey: string, expected?: TerminalCreateQueueEntry<TBase, TOptions>): boolean {
    const queue = this.createEntriesByWorktree.get(terminalWorktreeKey)
    if (!queue || queue.length === 0) return false
    if (!expected) {
      this.createEntriesByWorktree.delete(terminalWorktreeKey)
      return true
    }
    const index = queue.indexOf(expected)
    if (index < 0) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.createEntriesByWorktree.delete(terminalWorktreeKey)
    return index === 0
  }

  rejectCreatesForWorktree(
    terminalWorktreeKey: string,
    error: unknown,
    options: { includeActive: boolean },
  ): boolean {
    const queue = this.createEntriesByWorktree.get(terminalWorktreeKey)
    if (!queue || queue.length === 0) return false
    const start = options.includeActive ? 0 : 1
    const rejected = queue.splice(start)
    if (queue.length === 0) this.createEntriesByWorktree.delete(terminalWorktreeKey)
    for (const pending of rejected) pending.reject(error)
    return rejected.length > 0
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
    for (const queue of this.createEntriesByWorktree.values()) {
      for (const pending of queue) pending.reject(error)
    }
    for (const pending of this.pendingCloseByTerminalRuntimeSessionId.values()) pending.reject(error)
    this.createEntriesByWorktree.clear()
    this.pendingCloseByTerminalRuntimeSessionId.clear()
  }

  private createQueue(terminalWorktreeKey: string): TerminalCreateQueueEntry<TBase, TOptions>[] {
    const queue = this.createEntriesByWorktree.get(terminalWorktreeKey)
    if (queue) return queue
    const next: TerminalCreateQueueEntry<TBase, TOptions>[] = []
    this.createEntriesByWorktree.set(terminalWorktreeKey, next)
    return next
  }

  private settleClose(terminalRuntimeSessionId: string, entry: PendingTerminalClose, error: unknown): void {
    if (this.pendingCloseByTerminalRuntimeSessionId.get(terminalRuntimeSessionId) !== entry) return
    this.pendingCloseByTerminalRuntimeSessionId.delete(terminalRuntimeSessionId)
    if (error === null) entry.resolve()
    else entry.reject(error)
  }
}
