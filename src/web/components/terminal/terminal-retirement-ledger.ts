import type { TerminalRetirementEvent, WorkspaceRuntimeScope } from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { TerminalRuntimeMembershipIndex } from '#/web/components/terminal/types.ts'

export type TerminalRetirementFact = TerminalRetirementEvent

export interface TerminalRuntimeRetirementBinding {
  terminalSessionId: string
  terminalRuntimeSessionId: string
  terminalRuntimeGeneration: number
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

interface TerminalRetirementEntry {
  fact: TerminalRetirementFact
  bindingAuthority: 'unresolved' | 'confirmed' | 'conflicting'
  catalogPresence: 'unknown' | 'absent'
  presentation:
    | 'blocked'
    | 'pending'
    | { kind: 'claimed'; claim: TerminalRetirementPresentationClaim }
    | { kind: 'suppressed'; suppression: TerminalRetirementSuppression }
    | 'settled'
}

interface TerminalRetirementPresentationClaim {
  readonly fact: TerminalRetirementFact
  readonly invalidation: AbortController
}

export type TerminalRetirementSnapshotDecision =
  | { kind: 'block-binding' }
  | { kind: 'retire-present-binding'; retirement: TerminalRetirementFact }
  | { kind: 'retire-absent-binding'; retirement: TerminalRetirementFact }

export interface TerminalRetirementSuppression {
  settle(): void
  release(): TerminalRetirementFact | null
}

/**
 * Correlates authoritative retirement facts with independently delivered
 * catalog snapshots and owns accepted presentation facts until a consumer
 * explicitly settles them. An unresolved fact can be confirmed by an exact
 * binding or a causally covering absence. A conflicting fact was observed
 * against a different local binding, so absence alone cannot lend it authority.
 */
export class TerminalRetirementLedger {
  private readonly entries = new Map<string, TerminalRetirementEntry>()

  record(
    fact: TerminalRetirementFact,
    bindingAuthority: TerminalRetirementEntry['bindingAuthority'] = 'unresolved',
  ): void {
    const key = bindingKey(fact)
    const existing = this.entries.get(key)
    const retainedBindingAuthority =
      existing && bindingAuthorityRank(existing.bindingAuthority) > bindingAuthorityRank(bindingAuthority)
        ? existing.bindingAuthority
        : bindingAuthority
    const retainedFact = existing ? mergeDuplicateFacts(existing.fact, fact) : fact
    const presentation = existing?.presentation ?? 'blocked'
    const catalogPresence = existing?.catalogPresence ?? 'unknown'
    this.entries.delete(key)
    this.entries.set(key, {
      fact: retainedFact,
      bindingAuthority: retainedBindingAuthority,
      catalogPresence,
      presentation,
    })
    if (retainedBindingAuthority === 'confirmed') this.retainNewestConfirmedBinding(retainedFact)
  }

  matchingRetirement(binding: TerminalRuntimeRetirementBinding): TerminalRetirementFact | null {
    return this.entries.get(bindingKey(binding))?.fact ?? null
  }

  hasRetirement(binding: TerminalRuntimeRetirementBinding): boolean {
    return this.matchingRetirement(binding) !== null
  }

  accept(fact: TerminalRetirementFact, catalogPresence: TerminalRetirementEntry['catalogPresence'] = 'unknown'): void {
    const key = bindingKey(fact)
    this.record(fact, 'confirmed')
    const entry = this.entries.get(key)
    if (!entry) return
    if (catalogPresence === 'absent') entry.catalogPresence = 'absent'
    if (!entry.fact.retirementPresentation || entry.presentation !== 'blocked') return
    entry.presentation = 'pending'
  }

  suppress(fact: TerminalRetirementFact): TerminalRetirementSuppression | null {
    const key = bindingKey(fact)
    const entry = this.entries.get(key)
    if (!entry || (entry.presentation !== 'blocked' && entry.presentation !== 'pending')) return null
    const suppression: TerminalRetirementSuppression = {
      settle: () => {
        const current = this.entries.get(key)
        if (
          !current ||
          typeof current.presentation === 'string' ||
          current.presentation.kind !== 'suppressed' ||
          current.presentation.suppression !== suppression
        ) {
          return
        }
        current.presentation = 'settled'
        if (current.catalogPresence === 'absent') this.deleteEntry(key)
      },
      release: () => {
        const current = this.entries.get(key)
        if (
          !current ||
          typeof current.presentation === 'string' ||
          current.presentation.kind !== 'suppressed' ||
          current.presentation.suppression !== suppression
        ) {
          return null
        }
        current.presentation = current.fact.retirementPresentation ? 'pending' : 'blocked'
        return current.fact
      },
    }
    entry.presentation = { kind: 'suppressed', suppression }
    return suppression
  }

  claimPendingPresentation(): TerminalRetirementPresentationClaim | null {
    for (const entry of this.entries.values()) {
      if (typeof entry.presentation !== 'string' && entry.presentation.kind === 'claimed') return null
    }
    for (const entry of this.entries.values()) {
      if (entry.presentation !== 'pending') continue
      const claim = { fact: entry.fact, invalidation: new AbortController() }
      entry.presentation = { kind: 'claimed', claim }
      return claim
    }
    return null
  }

  presentationClaimInvalidationSignal(claim: TerminalRetirementPresentationClaim): AbortSignal {
    return claim.invalidation.signal
  }

  releasePresentationClaim(claim: TerminalRetirementPresentationClaim): boolean {
    const entry = this.entries.get(bindingKey(claim.fact))
    if (
      !entry ||
      typeof entry.presentation === 'string' ||
      entry.presentation.kind !== 'claimed' ||
      entry.presentation.claim !== claim
    ) {
      return false
    }
    entry.presentation = 'pending'
    return true
  }

  settlePresentationClaim(claim: TerminalRetirementPresentationClaim): boolean {
    const key = bindingKey(claim.fact)
    const entry = this.entries.get(key)
    if (
      !entry ||
      typeof entry.presentation === 'string' ||
      entry.presentation.kind !== 'claimed' ||
      entry.presentation.claim !== claim
    ) {
      return false
    }
    entry.presentation = 'settled'
    if (entry.catalogPresence === 'absent') this.deleteEntry(key)
    return true
  }

  /**
   * Reconciles facts against a complete authoritative snapshot. Exact present
   * bindings become activation tombstones. For an absent durable session, the
   * newest causally ordered fact is transferred before its ledger entries are
   * cleared, so the projection can accept retirement before generic membership
   * eviction destroys the local before-state.
   */
  reconcileAuthoritativeSnapshot(
    snapshotScope: WorkspaceRuntimeScope,
    presentBindings: readonly TerminalRuntimeRetirementBinding[],
    snapshotRevision: number | null,
  ): Map<string, TerminalRetirementSnapshotDecision> {
    const authoritativeBindingByTerminalSessionId = new Map(
      presentBindings
        .filter((binding) => sameScope(binding, snapshotScope))
        .map((binding) => [binding.terminalSessionId, binding]),
    )
    const absentEntriesByTerminalSessionId = new Map<string, Array<[string, TerminalRetirementEntry]>>()
    const decisions = new Map<string, TerminalRetirementSnapshotDecision>()
    for (const [key, entry] of this.entries) {
      if (!sameScope(entry.fact, snapshotScope)) continue
      const terminalSessionId = entry.fact.terminalSessionId
      const authoritativeBinding = authoritativeBindingByTerminalSessionId.get(terminalSessionId)
      if (!authoritativeBinding) {
        if (snapshotRevision === null || snapshotRevision < entry.fact.catalogRevision) {
          decisions.set(terminalSessionId, { kind: 'block-binding' })
          continue
        }
        if (entry.bindingAuthority === 'conflicting') {
          this.deleteEntry(key)
          continue
        }
        const absentEntries = absentEntriesByTerminalSessionId.get(terminalSessionId) ?? []
        absentEntries.push([key, entry])
        absentEntriesByTerminalSessionId.set(terminalSessionId, absentEntries)
        continue
      }
      if (key === bindingKey(authoritativeBinding)) {
        entry.bindingAuthority = 'confirmed'
        entry.catalogPresence = 'unknown'
        decisions.set(
          terminalSessionId,
          entry.fact.retirementPresentation
            ? { kind: 'retire-present-binding', retirement: entry.fact }
            : { kind: 'block-binding' },
        )
        continue
      }
      const snapshotCoversRetirement = snapshotRevision !== null && snapshotRevision >= entry.fact.catalogRevision
      if (snapshotCoversRetirement) this.deleteEntry(key)
      else if (decisions.get(terminalSessionId)?.kind !== 'retire-present-binding') {
        decisions.set(terminalSessionId, { kind: 'block-binding' })
      }
    }
    for (const [terminalSessionId, candidates] of absentEntriesByTerminalSessionId) {
      if (decisions.get(terminalSessionId)?.kind === 'block-binding') continue
      const winner = candidates.reduce((current, candidate) =>
        retirementCandidatePrecedes(current[1], candidate[1]) ? candidate : current,
      )
      for (const [key, entry] of candidates) {
        if (entry !== winner[1]) this.deleteEntry(key)
      }
      const [winnerKey, winnerEntry] = winner
      winnerEntry.catalogPresence = 'absent'
      decisions.set(winnerEntry.fact.terminalSessionId, {
        kind: 'retire-absent-binding',
        retirement: winnerEntry.fact,
      })
      if (winnerEntry.presentation === 'settled' || !winnerEntry.fact.retirementPresentation) {
        this.deleteEntry(winnerKey)
      }
    }
    return decisions
  }

  retainRuntimeMemberships(runtimeMembershipIndex: TerminalRuntimeMembershipIndex): void {
    for (const [key, entry] of this.entries) {
      if (runtimeMembershipIndex.get(entry.fact.workspaceId)?.workspaceRuntimeId !== entry.fact.workspaceRuntimeId) {
        this.deleteEntry(key)
      }
    }
  }

  clear(): void {
    for (const key of this.entries.keys()) this.deleteEntry(key)
  }

  size(): number {
    return this.entries.size
  }

  private retainNewestConfirmedBinding(fact: TerminalRetirementFact): void {
    const candidates = Array.from(this.entries).filter(
      ([, entry]) =>
        entry.bindingAuthority === 'confirmed' &&
        entry.fact.terminalSessionId === fact.terminalSessionId &&
        sameScope(entry.fact, fact),
    )
    if (candidates.length < 2) return
    const winner = candidates.reduce((current, candidate) =>
      retirementCandidatePrecedes(current[1], candidate[1]) ? candidate : current,
    )
    for (const [key, entry] of candidates) {
      if (entry !== winner[1]) this.deleteEntry(key)
    }
  }

  private deleteEntry(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (typeof entry.presentation !== 'string' && entry.presentation.kind === 'claimed') {
      const { claim } = entry.presentation
      claim.invalidation.abort()
    }
    this.entries.delete(key)
  }
}

function bindingAuthorityRank(bindingAuthority: TerminalRetirementEntry['bindingAuthority']): number {
  if (bindingAuthority === 'confirmed') return 2
  if (bindingAuthority === 'conflicting') return 1
  return 0
}

function retirementCandidatePrecedes(current: TerminalRetirementEntry, candidate: TerminalRetirementEntry): boolean {
  if (candidate.fact.catalogRevision !== current.fact.catalogRevision) {
    return candidate.fact.catalogRevision > current.fact.catalogRevision
  }
  if (
    candidate.fact.terminalRuntimeSessionId === current.fact.terminalRuntimeSessionId &&
    candidate.fact.terminalRuntimeGeneration !== current.fact.terminalRuntimeGeneration
  ) {
    return candidate.fact.terminalRuntimeGeneration > current.fact.terminalRuntimeGeneration
  }
  const currentPresentationRank = presentationRank(current.presentation)
  const candidatePresentationRank = presentationRank(candidate.presentation)
  if (candidatePresentationRank !== currentPresentationRank) return candidatePresentationRank > currentPresentationRank
  if (!!candidate.fact.retirementPresentation !== !!current.fact.retirementPresentation) {
    return !!candidate.fact.retirementPresentation
  }
  return false
}

function presentationRank(presentation: TerminalRetirementEntry['presentation']): number {
  if (typeof presentation !== 'string') return 3
  if (presentation === 'pending') return 2
  if (presentation === 'settled') return 1
  return 0
}

function mergeDuplicateFacts(
  current: TerminalRetirementFact,
  incoming: TerminalRetirementFact,
): TerminalRetirementFact {
  const latest = incoming.catalogRevision >= current.catalogRevision ? incoming : current
  return {
    ...latest,
    catalogRevision: Math.max(current.catalogRevision, incoming.catalogRevision),
    retirementPresentation: current.retirementPresentation ?? incoming.retirementPresentation,
  }
}

function bindingKey(binding: TerminalRuntimeRetirementBinding): string {
  return JSON.stringify([
    binding.workspaceId,
    binding.workspaceRuntimeId,
    binding.terminalSessionId,
    binding.terminalRuntimeSessionId,
    binding.terminalRuntimeGeneration,
  ])
}

function sameScope(
  binding: Pick<TerminalRuntimeRetirementBinding, 'workspaceId' | 'workspaceRuntimeId'>,
  scope: WorkspaceRuntimeScope,
): boolean {
  return binding.workspaceId === scope.workspaceId && binding.workspaceRuntimeId === scope.workspaceRuntimeId
}
