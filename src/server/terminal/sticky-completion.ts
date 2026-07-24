export interface StickyCompletionSubscription {
  dispose(): void
}

export class StickyCompletion {
  private readonly listeners = new Set<() => void>()
  private completedValue = false

  get completed(): boolean {
    return this.completedValue
  }

  complete(): boolean {
    if (this.completedValue) return false
    this.completedValue = true
    const listeners = Array.from(this.listeners)
    this.listeners.clear()
    for (const listener of listeners) {
      try {
        listener()
      } catch {}
    }
    return true
  }

  subscribe(listener: () => void): StickyCompletionSubscription {
    let subscribed = true
    const dispose = () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(notify)
    }
    const notify = () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(notify)
      listener()
    }
    if (this.completedValue) queueMicrotask(notify)
    else this.listeners.add(notify)
    return { dispose }
  }

  waitUntilCompleted(): Promise<void> {
    if (this.completedValue) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.subscribe(resolve)
    })
  }

  wait(timeoutMs: number, timeoutMessage: string): Promise<void> {
    if (this.completedValue) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const subscription = this.subscribe(() => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve()
      })
      timer = setTimeout(() => {
        if (settled) return
        settled = true
        subscription.dispose()
        reject(new Error(timeoutMessage))
      }, timeoutMs)
    })
  }
}
