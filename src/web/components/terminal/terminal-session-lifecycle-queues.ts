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
 */
export interface TerminalCreateQueueEntry<TBase, TOptions, TResult = string> {
  base: TBase
  options: TOptions
  promise: Promise<TResult>
  resolve: (result: TResult) => void
  reject: (error: unknown) => void
  flushing: boolean
  creating: boolean
}

export interface TerminalCreateQueueAdmission<TResult = string> {
  promise: Promise<TResult>
  ownsAdmission: boolean
}

export class TerminalSessionLifecycleQueues<TBase, TOptions, TResult = string> {
  private readonly createEntriesByWorktree = new Map<string, TerminalCreateQueueEntry<TBase, TOptions, TResult>[]>()

  enqueueCreate(input: {
    terminalWorktreeKey: string
    base: TBase
    options: TOptions
    isSameRequest: (existing: TOptions, next: TOptions) => boolean
    flush: (terminalWorktreeKey: string) => void
  }): TerminalCreateQueueAdmission<TResult> {
    const queue = this.createQueue(input.terminalWorktreeKey)
    const existing = queue.find((entry) => input.isSameRequest(entry.options, input.options))
    if (existing) return { promise: existing.promise, ownsAdmission: false }
    let resolve!: (result: TResult) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<TResult>((innerResolve, innerReject) => {
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
    return { promise, ownsAdmission: true }
  }

  getCreate(terminalWorktreeKey: string): TerminalCreateQueueEntry<TBase, TOptions, TResult> | undefined {
    return this.createEntriesByWorktree.get(terminalWorktreeKey)?.[0]
  }

  hasCreate(terminalWorktreeKey: string): boolean {
    return (this.createEntriesByWorktree.get(terminalWorktreeKey)?.length ?? 0) > 0
  }

  deleteCreate(terminalWorktreeKey: string, expected?: TerminalCreateQueueEntry<TBase, TOptions, TResult>): boolean {
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

  rejectCreatesForWorktree(terminalWorktreeKey: string, error: unknown, options: { includeActive: boolean }): boolean {
    const queue = this.createEntriesByWorktree.get(terminalWorktreeKey)
    if (!queue || queue.length === 0) return false
    const start = options.includeActive ? 0 : 1
    const rejected = queue.splice(start)
    if (queue.length === 0) this.createEntriesByWorktree.delete(terminalWorktreeKey)
    for (const pending of rejected) pending.reject(error)
    return rejected.length > 0
  }

  rejectAll(error: unknown): void {
    for (const queue of this.createEntriesByWorktree.values()) {
      for (const pending of queue) pending.reject(error)
    }
    this.createEntriesByWorktree.clear()
  }

  private createQueue(terminalWorktreeKey: string): TerminalCreateQueueEntry<TBase, TOptions, TResult>[] {
    const queue = this.createEntriesByWorktree.get(terminalWorktreeKey)
    if (queue) return queue
    const next: TerminalCreateQueueEntry<TBase, TOptions, TResult>[] = []
    this.createEntriesByWorktree.set(terminalWorktreeKey, next)
    return next
  }

}
