import { describe, expect, test } from 'vitest'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  TerminalRetirementLedger,
  type TerminalRetirementFact,
  type TerminalRetirementSnapshotDecision,
} from '#/web/components/terminal/terminal-retirement-ledger.ts'

function workspaceIdFixture(input: string) {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  return workspaceId
}

const WORKSPACE_A = workspaceIdFixture('goblin+file:///workspace-a')
const WORKSPACE_B = workspaceIdFixture('goblin+file:///workspace-b')
const SCOPE_A = { workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' }
const WORKSPACE_A_BASE = {
  target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
  presentation: { kind: 'workspace-root' as const },
}

function fact(index: number): TerminalRetirementFact {
  return {
    terminalSessionId: `term-${index}`,
    terminalRuntimeSessionId: `pty-${index}`,
    terminalRuntimeGeneration: 1,
    workspaceId: WORKSPACE_A,
    workspaceRuntimeId: 'runtime-a',
    catalogRevision: 1,
    retirementPresentation: null,
  }
}

function reconciledRetirements(
  decisions: ReadonlyMap<string, TerminalRetirementSnapshotDecision>,
): TerminalRetirementFact[] {
  return Array.from(decisions.values()).flatMap((decision) =>
    decision.kind === 'block-binding' ? [] : [decision.retirement],
  )
}

describe('TerminalRetirementLedger', () => {
  test('retains authoritative facts until their runtime scope is reconciled or retired', () => {
    const ledger = new TerminalRetirementLedger()
    for (let index = 0; index < 300; index += 1) ledger.record(fact(index))

    expect(ledger.size()).toBe(300)
    expect(ledger.hasRetirement(fact(0))).toBe(true)

    ledger.retainRuntimeMemberships(new Map())
    expect(ledger.size()).toBe(0)
  })

  test('deduplicates repeated delivery of one retirement fact', () => {
    const ledger = new TerminalRetirementLedger()
    for (let index = 0; index < 1_000; index += 1) ledger.record(fact(1))
    expect(ledger.size()).toBe(1)
  })

  test('preserves binding authority while replacing a duplicate with richer immutable context', () => {
    const ledger = new TerminalRetirementLedger()
    const original = fact(1)
    const richer = {
      ...original,
      retirementPresentation: {
        target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
        terminalBase: WORKSPACE_A_BASE,
        tabsBeforeRetirement: [],
      },
    }
    ledger.record(original, 'confirmed')
    ledger.record(richer)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([richer])
  })

  test('never lets a context-free duplicate downgrade accepted presentation context', () => {
    const ledger = new TerminalRetirementLedger()
    const contextFree = fact(1)
    const rich = {
      ...contextFree,
      retirementPresentation: {
        target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
        terminalBase: WORKSPACE_A_BASE,
        tabsBeforeRetirement: [],
      },
    }

    ledger.record(rich)
    ledger.accept(contextFree)

    expect(ledger.claimPendingPresentation()?.fact).toEqual(rich)
  })

  test('does not let a delayed older confirmed binding replace a newer confirmed retirement', () => {
    const ledger = new TerminalRetirementLedger()
    const older = fact(1)
    const newer = {
      ...older,
      terminalRuntimeGeneration: 2,
      catalogRevision: 2,
    }
    ledger.record(newer, 'confirmed')
    ledger.record(older, 'confirmed')

    expect(ledger.hasRetirement(newer)).toBe(true)
    expect(ledger.hasRetirement(older)).toBe(false)
    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 2))).toEqual([newer])
  })

  test('allows only one presentation claim at a time', () => {
    const ledger = new TerminalRetirementLedger()
    const first = {
      ...fact(1),
      retirementPresentation: {
        target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
        terminalBase: WORKSPACE_A_BASE,
        tabsBeforeRetirement: [],
      },
    }
    const second = { ...first, terminalSessionId: 'term-2', terminalRuntimeSessionId: 'pty-2' }
    ledger.accept(first)
    ledger.accept(second)

    const firstClaim = ledger.claimPendingPresentation()
    expect(firstClaim?.fact).toEqual(first)
    expect(ledger.claimPendingPresentation()).toBeNull()

    if (!firstClaim) throw new Error('missing first presentation claim')
    ledger.settlePresentationClaim(firstClaim)
    expect(ledger.claimPendingPresentation()?.fact).toEqual(second)
  })

  test('invalidates pending-close suppression when its runtime scope retires', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = fact(1)
    ledger.record(retirement, 'confirmed')
    const suppression = ledger.suppress(retirement)
    if (!suppression) throw new Error('missing retirement suppression')

    ledger.retainRuntimeMemberships(new Map())

    expect(suppression.release()).toBeNull()
    expect(ledger.size()).toBe(0)
  })

  test('blocks an older different-binding snapshot without contesting a future fact', () => {
    const ledger = new TerminalRetirementLedger()
    const future = { ...fact(1), terminalRuntimeGeneration: 2, catalogRevision: 2 }
    const olderBinding = { ...future, terminalRuntimeGeneration: 1 }
    ledger.record(future)

    const stale = ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [olderBinding], 1)
    expect(stale.get(future.terminalSessionId)).toEqual({ kind: 'block-binding' })
    expect(ledger.hasRetirement(future)).toBe(true)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 2))).toEqual([future])
  })

  test('invalidates an active presentation claim when a covering catalog confirms another binding', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = {
      ...fact(1),
      retirementPresentation: {
        target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
        terminalBase: WORKSPACE_A_BASE,
        tabsBeforeRetirement: [],
      },
    }
    ledger.accept(retirement)
    const claim = ledger.claimPendingPresentation()
    if (!claim) throw new Error('missing retirement presentation claim')
    const invalidationSignal = ledger.presentationClaimInvalidationSignal(claim)

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [{ ...retirement, terminalRuntimeSessionId: 'pty-replacement' }], 1)

    expect(invalidationSignal.aborted).toBe(true)
    expect(ledger.settlePresentationClaim(claim)).toBe(false)
    expect(ledger.hasRetirement(retirement)).toBe(false)
  })

  test('promotes an exact present binding to a durable activation tombstone', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = fact(1)
    ledger.record(retirement)
    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [retirement], null))).toEqual([])

    expect(ledger.hasRetirement(retirement)).toBe(true)
  })

  test('transfers an absent retirement before clearing its tombstone', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = fact(1)
    ledger.record(retirement, 'confirmed')

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([retirement])
    expect(ledger.hasRetirement(retirement)).toBe(false)
  })

  test('transfers an unconfirmed future retirement when the next complete snapshot is already absent', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(retirement)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([retirement])
    expect(ledger.size()).toBe(0)
  })

  test('retains a known successor while its complete snapshot is delayed', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(retirement)

    expect(ledger.hasRetirement(retirement)).toBe(true)
    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([retirement])
  })

  test('chooses the newest fact carrying presentation context for one absent durable session', () => {
    const ledger = new TerminalRetirementLedger()
    const older = fact(1)
    const target = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' }
    const newer = {
      ...older,
      terminalRuntimeGeneration: 2,
      retirementPresentation: { target, terminalBase: WORKSPACE_A_BASE, tabsBeforeRetirement: [] },
    }
    ledger.record(older)
    ledger.record(newer)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([newer])
    expect(ledger.size()).toBe(1)
  })

  test('settles all covered successor candidates after choosing one durable retirement', () => {
    const ledger = new TerminalRetirementLedger()
    const target = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' }
    const generation2 = {
      ...fact(1),
      terminalRuntimeGeneration: 2,
      retirementPresentation: { target, terminalBase: WORKSPACE_A_BASE, tabsBeforeRetirement: [] },
    }
    const generation3 = { ...generation2, terminalRuntimeGeneration: 3 }
    ledger.record(generation2)
    ledger.record(generation3)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([generation3])
    ledger.accept(generation3, 'absent')
    const claim = ledger.claimPendingPresentation()
    if (!claim) throw new Error('missing retirement presentation claim')
    ledger.settlePresentationClaim(claim)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([])
    expect(ledger.size()).toBe(0)
  })

  test('lets a newer authoritative retirement supersede an older suppressed binding', () => {
    const ledger = new TerminalRetirementLedger()
    const older = { ...fact(1), catalogRevision: 1 }
    const newer = { ...older, terminalRuntimeGeneration: 2, catalogRevision: 2 }
    ledger.accept(older)
    const suppression = ledger.suppress(older)
    if (!suppression) throw new Error('missing retirement suppression')
    ledger.record(newer)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 2))).toEqual([newer])
    expect(suppression.release()).toBeNull()
  })

  test('keeps plausible future facts while a different binding is authoritative', () => {
    const ledger = new TerminalRetirementLedger()
    const generation1 = fact(1)
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(generation1, 'confirmed')
    ledger.record(generation2)

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation1], null)

    expect(ledger.hasRetirement(generation1)).toBe(true)
    expect(ledger.hasRetirement(generation2)).toBe(true)
  })

  test('keeps a comparable successor across an intermediate generation and later confirms its absence', () => {
    const ledger = new TerminalRetirementLedger()
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    const generation3 = { ...fact(1), terminalRuntimeGeneration: 3 }
    ledger.record(generation3)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation2], null))).toEqual([])
    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([generation3])
  })

  test('retires a successor once a newer generation is authoritative', () => {
    const ledger = new TerminalRetirementLedger()
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    const generation3 = { ...fact(1), terminalRuntimeGeneration: 3 }
    ledger.record(generation2)

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation3], 1)

    expect(ledger.hasRetirement(generation2)).toBe(false)
  })

  test('retires an incomparable successor once a covering catalog confirms another lineage', () => {
    const ledger = new TerminalRetirementLedger()
    const successor = { ...fact(1), terminalRuntimeSessionId: 'pty-successor' }
    const authoritative = { ...fact(1), terminalRuntimeSessionId: 'pty-authoritative' }
    ledger.record(successor)

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [authoritative], 1)

    expect(ledger.hasRetirement(successor)).toBe(false)
    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([])
  })

  test('retires a stale durable tombstone when a different binding becomes authoritative', () => {
    const ledger = new TerminalRetirementLedger()
    const generation1 = fact(1)
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(generation1, 'confirmed')

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation2], 1)

    expect(ledger.hasRetirement(generation1)).toBe(false)
  })

  test('does not transfer unresolved foreign facts on absence', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = fact(1)
    ledger.record(retirement, 'conflicting')

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([])
    expect(ledger.size()).toBe(0)
  })

  test('retains a conflicting fact until an empty snapshot causally covers it', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = { ...fact(1), catalogRevision: 2 }
    ledger.record(retirement, 'conflicting')

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([])
    expect(ledger.hasRetirement(retirement)).toBe(true)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 2))).toEqual([])
    expect(ledger.hasRetirement(retirement)).toBe(false)
  })

  test('reconciles and retires only the requested workspace-runtime scope', () => {
    const ledger = new TerminalRetirementLedger()
    const repoA = fact(1)
    const repoB = {
      ...fact(2),
      workspaceId: WORKSPACE_B,
      workspaceRuntimeId: 'runtime-b',
    }
    ledger.record(repoA)
    ledger.record(repoB)

    expect(reconciledRetirements(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [], 1))).toEqual([repoA])
    expect(ledger.hasRetirement(repoB)).toBe(true)

    ledger.retainRuntimeMemberships(new Map())
    expect(ledger.size()).toBe(0)
  })

  test('retains causally distinct future generations until catalog authority resolves them', () => {
    const ledger = new TerminalRetirementLedger()
    const generation1 = fact(1)
    const generation2 = { ...generation1, terminalRuntimeGeneration: 2 }
    const generation3 = { ...generation1, terminalRuntimeGeneration: 3 }
    ledger.record(generation1, 'confirmed')
    ledger.record(generation2)
    ledger.record(generation3)

    expect(ledger.size()).toBe(3)
    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation2], null)
    expect(ledger.hasRetirement(generation2)).toBe(true)
    expect(ledger.hasRetirement(generation3)).toBe(true)
  })
})
