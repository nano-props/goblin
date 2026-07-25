import type { TerminalRetirementEvent } from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type TerminalRetirementFact = TerminalRetirementEvent

export interface TerminalRuntimeRetirementBinding {
  terminalSessionId: string
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

interface TerminalRetirementLedgerOptions {
  capacity?: number
  ttlMs?: number
  now?: () => number
}

interface TerminalRetirementEntry {
  fact: TerminalRetirementFact
  correlation: 'unresolved' | 'successor' | 'durable'
  expiresAt: number | null
  snapshotScopeKey: string
}

const DEFAULT_CAPACITY = 256
const DEFAULT_TTL_MS = 30_000

/**
 * Correlates authoritative retirement facts with independently delivered
 * catalog snapshots. Unresolved facts are bounded until an exact snapshot
 * confirms their binding. Facts known to describe a successor binding may
 * also be confirmed by authoritative absence; facts accepted for a local
 * binding remain durable until that absence arrives.
 */
export class TerminalRetirementLedger {
  private readonly entries = new Map<string, TerminalRetirementEntry>()
  private readonly capacity: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: TerminalRetirementLedgerOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_TTL_MS)
    this.now = options.now ?? Date.now
  }

  record(fact: TerminalRetirementFact, correlation: 'unresolved' | 'successor' | 'durable' = 'unresolved'): void {
    const now = this.now()
    this.pruneExpired(now)
    const key = bindingKey(fact)
    const existing = this.entries.get(key)
    const retainedCorrelation =
      existing && correlationRank(existing.correlation) > correlationRank(correlation)
        ? existing.correlation
        : correlation
    if (retainedCorrelation === 'durable') this.retireOtherDurableBindings(fact, key)
    this.entries.delete(key)
    if (retainedCorrelation === 'unresolved') {
      while (this.unresolvedCount() >= this.capacity) {
        if (!this.evictOldestUnresolved()) break
      }
    }
    this.entries.set(key, {
      fact,
      correlation: retainedCorrelation,
      expiresAt: retainedCorrelation === 'unresolved' ? now + this.ttlMs : null,
      snapshotScopeKey: scopeKey(fact),
    })
  }

  matchingRetirement(binding: TerminalRuntimeRetirementBinding): TerminalRetirementFact | null {
    this.pruneExpired(this.now())
    return this.entries.get(bindingKey(binding))?.fact ?? null
  }

  hasRetirement(binding: TerminalRuntimeRetirementBinding): boolean {
    return this.matchingRetirement(binding) !== null
  }

  removeSession(terminalSessionId: string): void {
    this.pruneExpired(this.now())
    for (const [key, entry] of this.entries) {
      if (entry.fact.terminalSessionId === terminalSessionId) this.entries.delete(key)
    }
  }

  /**
   * Reconciles facts against a complete authoritative snapshot. Exact present
   * bindings become activation tombstones. For an absent durable session, the
   * newest fact carrying presentation context (or simply the newest fact when
   * none carries context) is transferred before its ledger entries are cleared,
   * so the projection can accept retirement before generic membership eviction
   * destroys the local before-state.
   */
  reconcileAuthoritativeSnapshot(
    snapshotScopeKey: string,
    presentBindings: readonly TerminalRuntimeRetirementBinding[],
  ): TerminalRetirementFact[] {
    const now = this.now()
    this.pruneExpired(now)
    const authoritativeBindingByTerminalSessionId = new Map(
      presentBindings
        .filter((binding) => scopeKey(binding) === snapshotScopeKey)
        .map((binding) => [binding.terminalSessionId, binding]),
    )
    const absentFactsByTerminalSessionId = new Map<string, TerminalRetirementFact>()
    for (const [key, entry] of this.entries) {
      if (entry.snapshotScopeKey !== snapshotScopeKey) continue
      const terminalSessionId = entry.fact.terminalSessionId
      const authoritativeBinding = authoritativeBindingByTerminalSessionId.get(terminalSessionId)
      if (!authoritativeBinding) {
        if (entry.correlation !== 'unresolved') {
          const current = absentFactsByTerminalSessionId.get(terminalSessionId)
          if (!current || entry.fact.retirementPresentation || !current.retirementPresentation) {
            absentFactsByTerminalSessionId.set(terminalSessionId, entry.fact)
          }
        }
        this.entries.delete(key)
        continue
      }
      if (key === bindingKey(authoritativeBinding)) {
        entry.correlation = 'durable'
        entry.expiresAt = null
      } else if (entry.correlation === 'durable') {
        this.entries.delete(key)
      } else if (entry.correlation === 'successor') {
        if (
          entry.fact.terminalRuntimeSessionId === authoritativeBinding.terminalRuntimeSessionId &&
          entry.fact.terminalRuntimeGeneration <= authoritativeBinding.terminalRuntimeGeneration
        ) {
          this.entries.delete(key)
        } else if (entry.fact.terminalRuntimeSessionId !== authoritativeBinding.terminalRuntimeSessionId) {
          entry.correlation = 'unresolved'
          entry.expiresAt = now + this.ttlMs
        }
      }
    }
    return Array.from(absentFactsByTerminalSessionId.values())
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
      if (entry.correlation === 'unresolved' && entry.expiresAt !== null && entry.expiresAt <= now) {
        this.entries.delete(key)
      }
    }
  }

  private unresolvedCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.correlation === 'unresolved') count += 1
    }
    return count
  }

  private evictOldestUnresolved(): boolean {
    for (const [key, entry] of this.entries) {
      if (entry.correlation !== 'unresolved') continue
      this.entries.delete(key)
      return true
    }
    return false
  }

  private retireOtherDurableBindings(fact: TerminalRetirementFact, retainedKey: string): void {
    const factScopeKey = scopeKey(fact)
    for (const [key, entry] of this.entries) {
      if (key === retainedKey || entry.correlation !== 'durable') continue
      if (entry.snapshotScopeKey !== factScopeKey) continue
      if (entry.fact.terminalSessionId === fact.terminalSessionId) this.entries.delete(key)
    }
  }
}

function correlationRank(correlation: TerminalRetirementEntry['correlation']): number {
  if (correlation === 'durable') return 2
  if (correlation === 'successor') return 1
  return 0
}

function bindingKey(binding: TerminalRuntimeRetirementBinding): string {
  return `${scopeKey(binding)}:${binding.terminalSessionId}:${binding.terminalRuntimeSessionId}:${binding.terminalRuntimeGeneration}`
}

function scopeKey(binding: Pick<TerminalRuntimeRetirementBinding, 'workspaceId' | 'workspaceRuntimeId'>): string {
  return JSON.stringify([binding.workspaceId, binding.workspaceRuntimeId])
}
