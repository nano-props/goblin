export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  options?: { signal?: AbortSignal; abort?: 'return' | 'throw' },
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const takeNextIndex = () => {
    if (nextIndex >= items.length) return undefined
    const index = nextIndex
    nextIndex += 1
    return index
  }
  const worker = async () => {
    while (true) {
      if (options?.signal?.aborted) {
        if (options.abort === 'throw') throw new Error('cancelled')
        return
      }
      const i = takeNextIndex()
      if (i === undefined) return
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
