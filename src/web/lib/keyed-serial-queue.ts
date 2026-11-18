/** Runs commands in submission order for each owner. */
export class KeyedSerialQueue {
  private readonly tails = new Map<string, Promise<void>>()

  get size(): number {
    return this.tails.size
  }

  has(key: string): boolean {
    return this.tails.has(key)
  }

  async run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const preceding = this.tails.get(key)
    const settled = Promise.withResolvers<void>()
    this.tails.set(key, settled.promise)

    // An idle command starts in this turn so it can register nested admission
    // before a following command requests exclusive access.
    if (preceding) await preceding
    try {
      return await task()
    } finally {
      if (this.tails.get(key) === settled.promise) this.tails.delete(key)
      settled.resolve()
    }
  }
}
