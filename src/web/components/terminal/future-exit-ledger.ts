import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface FutureExitBinding {
  terminalSessionId: string
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

interface FutureExitLedgerOptions {
  capacity?: number
  ttlMs?: number
  now?: () => number
}

interface FutureExitEntry {
  binding: FutureExitBinding
  lifecycle: 'orphan' | 'durable'
  expiresAt: number | null
  snapshotScopeKey: string
}

const DEFAULT_CAPACITY = 256
const DEFAULT_TTL_MS = 30_000

export class FutureExitLedger {
  private readonly entries = new Map<string, FutureExitEntry>()
  private readonly capacity: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: FutureExitLedgerOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS)
    this.now = options.now ?? Date.now
  }

  record(binding: FutureExitBinding, lifecycle: 'orphan' | 'durable' = 'orphan'): void {
    const now = this.now()
    this.pruneExpired(now)
    const key = bindingKey(binding)
    const existing = this.entries.get(key)
    if (existing?.lifecycle === 'durable' && lifecycle === 'orphan') return
    if (lifecycle === 'durable') this.retireOtherDurableBindings(binding, key)
    this.entries.delete(key)
    if (lifecycle === 'orphan') {
      while (this.orphanCount() >= this.capacity) {
        if (!this.evictOldestOrphan()) break
      }
    }
    this.entries.set(key, {
      binding,
      lifecycle,
      expiresAt: lifecycle === 'orphan' ? now + this.ttlMs : null,
      snapshotScopeKey: scopeKey(binding),
    })
  }

  blocksActivation(binding: FutureExitBinding): boolean {
    this.pruneExpired(this.now())
    return this.entries.has(bindingKey(binding))
  }

  removeSession(terminalSessionId: string): void {
    this.pruneExpired(this.now())
    for (const [key, entry] of this.entries) {
      if (entry.binding.terminalSessionId === terminalSessionId) this.entries.delete(key)
    }
  }

  confirmAuthoritativeSnapshot(snapshotScopeKey: string, presentBindings: readonly FutureExitBinding[]): void {
    this.pruneExpired(this.now())
    const authoritativeBindingKeyByTerminalSessionId = new Map(
      presentBindings
        .filter((binding) => scopeKey(binding) === snapshotScopeKey)
        .map((binding) => [binding.terminalSessionId, bindingKey(binding)]),
    )
    for (const [key, entry] of this.entries) {
      if (entry.snapshotScopeKey !== snapshotScopeKey) continue
      const authoritativeKey = authoritativeBindingKeyByTerminalSessionId.get(entry.binding.terminalSessionId)
      if (!authoritativeKey) {
        this.entries.delete(key)
        continue
      }
      if (key === authoritativeKey) {
        entry.lifecycle = 'durable'
        entry.expiresAt = null
      } else if (entry.lifecycle === 'durable') {
        this.entries.delete(key)
      }
    }
  }

  retireSnapshotScope(snapshotScopeKey: string): void {
    this.pruneExpired(this.now())
    for (const [key, entry] of this.entries) {
      if (entry.snapshotScopeKey === snapshotScopeKey) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  size(): number {
    this.pruneExpired(this.now())
    return this.entries.size
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.lifecycle === 'orphan' && entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
  }

  private orphanCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.lifecycle === 'orphan') count += 1
    }
    return count
  }

  private evictOldestOrphan(): boolean {
    for (const [key, entry] of this.entries) {
      if (entry.lifecycle !== 'orphan') continue
      this.entries.delete(key)
      return true
    }
    return false
  }

  private retireOtherDurableBindings(binding: FutureExitBinding, retainedKey: string): void {
    const bindingScopeKey = scopeKey(binding)
    for (const [key, entry] of this.entries) {
      if (key === retainedKey || entry.lifecycle !== 'durable') continue
      if (entry.snapshotScopeKey !== bindingScopeKey) continue
      if (entry.binding.terminalSessionId === binding.terminalSessionId) this.entries.delete(key)
    }
  }
}

function bindingKey(binding: FutureExitBinding): string {
  return `${scopeKey(binding)}:${binding.terminalSessionId}:${binding.terminalRuntimeSessionId}:${binding.terminalRuntimeGeneration}`
}

function scopeKey(binding: Pick<FutureExitBinding, 'workspaceId' | 'workspaceRuntimeId'>): string {
  return JSON.stringify([binding.workspaceId, binding.workspaceRuntimeId])
}
