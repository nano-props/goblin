export class RepoSyncTracker {
  private readonly ready = new Map<string, number>()
  private readonly timestamps = new Map<string, number>()
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(private readonly cooldownMs = 2000) {}

  isReady(repoRoot: string, instanceToken: number | undefined): boolean {
    return typeof instanceToken === 'number' && this.ready.get(repoRoot) === instanceToken
  }

  markReady(repoRoot: string, instanceToken: number): void {
    if (this.ready.get(repoRoot) === instanceToken) return
    this.ready.set(repoRoot, instanceToken)
    this.timestamps.set(repoRoot, Date.now())
    const listeners = this.listeners.get(repoRoot)
    if (!listeners) return
    for (const listener of Array.from(listeners)) listener()
  }

  shouldSync(repoRoot: string): boolean {
    const last = this.timestamps.get(repoRoot) ?? 0
    return Date.now() - last >= this.cooldownMs
  }

  subscribe(repoRoot: string, listener: () => void): () => void {
    let set = this.listeners.get(repoRoot)
    if (!set) {
      set = new Set()
      this.listeners.set(repoRoot, set)
    }
    set.add(listener)
    return () => {
      const current = this.listeners.get(repoRoot)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) this.listeners.delete(repoRoot)
    }
  }
}
