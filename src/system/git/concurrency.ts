import type PQueue from 'p-queue'

/** Cancel queued work promptly without letting p-queue release a running slot
 * before the underlying operation has actually settled. The task keeps the
 * caller signal so process cancellation still reaches Git or SSH. */
export async function runWithQueuedAdmission<T>(
  queue: PQueue,
  signal: AbortSignal | undefined,
  task: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted()
  if (!signal) return await queue.add(task)

  const admission = new AbortController()
  const abortWhileQueued = () => admission.abort(signal.reason)
  signal.addEventListener('abort', abortWhileQueued, { once: true })
  try {
    return await queue.add(
      async () => {
        signal.removeEventListener('abort', abortWhileQueued)
        signal.throwIfAborted()
        return await task()
      },
      { signal: admission.signal },
    )
  } finally {
    signal.removeEventListener('abort', abortWhileQueued)
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  options?: { signal?: AbortSignal; abort?: 'return' | 'throw' },
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  // Match Promise.all's fail-fast result without letting surviving workers
  // claim the rest of the input after one worker has already failed.
  let stopped = false
  const takeNextIndex = () => {
    if (nextIndex >= items.length) return undefined
    const index = nextIndex
    nextIndex += 1
    return index
  }
  const worker = async () => {
    while (true) {
      if (stopped) return
      if (options?.signal?.aborted) {
        if (options.abort === 'throw') throw new Error('cancelled')
        return
      }
      const i = takeNextIndex()
      if (i === undefined) return
      try {
        results[i] = await fn(items[i]!)
      } catch (err) {
        stopped = true
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
