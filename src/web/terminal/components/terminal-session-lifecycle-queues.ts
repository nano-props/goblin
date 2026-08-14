/**
 * Per-filesystem-target queue for terminal creation.
 *
 * Create requests are serialized by terminal filesystem target. A second
 * create for the same target either dedupes onto an existing active/queued
 * promise when `isSameRequest(existing, next)` is true, or waits in the same
 * visible queue when it is a distinct request. Same-request dedupe must
 * therefore resolve to the same terminalSessionId; distinct requests must get
 * their own later create attempt.
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
  private readonly createEntriesByFilesystemTarget = new Map<
    string,
    TerminalCreateQueueEntry<TBase, TOptions, TResult>[]
  >()

  enqueueCreate(input: {
    terminalFilesystemTargetKey: string
    base: TBase
    options: TOptions
    isSameRequest: (existing: TOptions, next: TOptions) => boolean
    flush: (terminalFilesystemTargetKey: string) => void
  }): TerminalCreateQueueAdmission<TResult> {
    const queue = this.createQueue(input.terminalFilesystemTargetKey)
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
    if (wasEmpty) input.flush(input.terminalFilesystemTargetKey)
    return { promise, ownsAdmission: true }
  }

  getCreate(terminalFilesystemTargetKey: string): TerminalCreateQueueEntry<TBase, TOptions, TResult> | undefined {
    return this.createEntriesByFilesystemTarget.get(terminalFilesystemTargetKey)?.[0]
  }

  hasCreate(terminalFilesystemTargetKey: string): boolean {
    return (this.createEntriesByFilesystemTarget.get(terminalFilesystemTargetKey)?.length ?? 0) > 0
  }

  deleteCreate(
    terminalFilesystemTargetKey: string,
    expected?: TerminalCreateQueueEntry<TBase, TOptions, TResult>,
  ): boolean {
    const queue = this.createEntriesByFilesystemTarget.get(terminalFilesystemTargetKey)
    if (!queue || queue.length === 0) return false
    if (!expected) {
      this.createEntriesByFilesystemTarget.delete(terminalFilesystemTargetKey)
      return true
    }
    const index = queue.indexOf(expected)
    if (index < 0) return false
    queue.splice(index, 1)
    if (queue.length === 0) this.createEntriesByFilesystemTarget.delete(terminalFilesystemTargetKey)
    return index === 0
  }

  rejectCreatesForFilesystemTarget(
    terminalFilesystemTargetKey: string,
    error: unknown,
    options: { includeActive: boolean },
  ): boolean {
    const queue = this.createEntriesByFilesystemTarget.get(terminalFilesystemTargetKey)
    if (!queue || queue.length === 0) return false
    const start = options.includeActive ? 0 : 1
    const rejected = queue.splice(start)
    if (queue.length === 0) this.createEntriesByFilesystemTarget.delete(terminalFilesystemTargetKey)
    for (const pending of rejected) pending.reject(error)
    return rejected.length > 0
  }

  rejectAll(error: unknown): void {
    for (const queue of this.createEntriesByFilesystemTarget.values()) {
      for (const pending of queue) pending.reject(error)
    }
    this.createEntriesByFilesystemTarget.clear()
  }

  private createQueue(terminalFilesystemTargetKey: string): TerminalCreateQueueEntry<TBase, TOptions, TResult>[] {
    const queue = this.createEntriesByFilesystemTarget.get(terminalFilesystemTargetKey)
    if (queue) return queue
    const next: TerminalCreateQueueEntry<TBase, TOptions, TResult>[] = []
    this.createEntriesByFilesystemTarget.set(terminalFilesystemTargetKey, next)
    return next
  }
}
