import { describe, expect, test } from 'vitest'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import {
  TerminalRetirementLedger,
  type TerminalRetirementFact,
} from '#/web/components/terminal/terminal-retirement-ledger.ts'

function workspaceIdFixture(input: string) {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  return workspaceId
}

const WORKSPACE_A = workspaceIdFixture('goblin+file:///workspace-a')
const WORKSPACE_B = workspaceIdFixture('goblin+file:///workspace-b')
const SCOPE_A = JSON.stringify([WORKSPACE_A, 'runtime-a'])

function fact(index: number): TerminalRetirementFact {
  return {
    terminalSessionId: `term-${index}`,
    terminalRuntimeSessionId: `pty-${index}`,
    terminalRuntimeGeneration: 1,
    workspaceId: WORKSPACE_A,
    workspaceRuntimeId: 'runtime-a',
    retirementPresentation: null,
  }
}

describe('TerminalRetirementLedger', () => {
  test('bounds and expires unconfirmed facts without evicting durable tombstones', () => {
    let now = 0
    const ledger = new TerminalRetirementLedger({ capacity: 2, ttlMs: 50, now: () => now })
    const durable = fact(0)
    ledger.record(durable, 'durable')
    ledger.record(fact(1))
    ledger.record(fact(2))
    ledger.record(fact(3))

    expect(ledger.hasRetirement(durable)).toBe(true)
    expect(ledger.hasRetirement(fact(1))).toBe(false)
    expect(ledger.hasRetirement(fact(3))).toBe(true)
    expect(ledger.size()).toBe(3)

    now = 50
    expect(ledger.size()).toBe(1)
    expect(ledger.hasRetirement(durable)).toBe(true)
  })

  test('deduplicates repeated delivery of one retirement fact', () => {
    const ledger = new TerminalRetirementLedger()
    for (let index = 0; index < 1_000; index += 1) ledger.record(fact(1))
    expect(ledger.size()).toBe(1)
  })

  test('preserves correlation while replacing a duplicate with richer immutable context', () => {
    const ledger = new TerminalRetirementLedger()
    const original = fact(1)
    const richer = {
      ...original,
      retirementPresentation: {
        target: { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' },
        tabsBeforeRetirement: [],
      },
    }
    ledger.record(original, 'durable')
    ledger.record(richer)

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([richer])
  })

  test('promotes an exact present binding to a durable activation tombstone', () => {
    let now = 0
    const ledger = new TerminalRetirementLedger({ ttlMs: 50, now: () => now })
    const retirement = fact(1)
    ledger.record(retirement, 'successor')
    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [retirement])).toEqual([])

    now = 5_000
    expect(ledger.hasRetirement(retirement)).toBe(true)
  })

  test('transfers an absent retirement before clearing its tombstone', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = fact(1)
    ledger.record(retirement, 'durable')

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([retirement])
    expect(ledger.hasRetirement(retirement)).toBe(false)
  })

  test('transfers an unconfirmed future retirement when the next complete snapshot is already absent', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(retirement, 'successor')

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([retirement])
    expect(ledger.size()).toBe(0)
  })

  test('does not expire a known successor while its complete snapshot is delayed', () => {
    let now = 0
    const ledger = new TerminalRetirementLedger({ ttlMs: 50, now: () => now })
    const retirement = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(retirement, 'successor')

    now = 5_000

    expect(ledger.hasRetirement(retirement)).toBe(true)
    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([retirement])
  })

  test('chooses the newest fact carrying presentation context for one absent durable session', () => {
    const ledger = new TerminalRetirementLedger()
    const older = fact(1)
    const target = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_A, workspaceRuntimeId: 'runtime-a' }
    const newer = {
      ...older,
      terminalRuntimeGeneration: 2,
      retirementPresentation: { target, tabsBeforeRetirement: [] },
    }
    ledger.record(older, 'successor')
    ledger.record(newer, 'successor')

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([newer])
    expect(ledger.size()).toBe(0)
  })

  test('keeps plausible future facts while a different binding is authoritative', () => {
    let now = 0
    const ledger = new TerminalRetirementLedger({ ttlMs: 50, now: () => now })
    const generation1 = fact(1)
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(generation1)
    ledger.record(generation2)

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation1])
    now = 50

    expect(ledger.hasRetirement(generation1)).toBe(true)
    expect(ledger.hasRetirement(generation2)).toBe(false)
  })

  test('keeps a comparable successor across an intermediate generation and later confirms its absence', () => {
    const ledger = new TerminalRetirementLedger()
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    const generation3 = { ...fact(1), terminalRuntimeGeneration: 3 }
    ledger.record(generation3, 'successor')

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation2])).toEqual([])
    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([generation3])
  })

  test('retires a successor once a newer generation is authoritative', () => {
    const ledger = new TerminalRetirementLedger()
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    const generation3 = { ...fact(1), terminalRuntimeGeneration: 3 }
    ledger.record(generation2, 'successor')

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation3])

    expect(ledger.hasRetirement(generation2)).toBe(false)
  })

  test('downgrades an incomparable successor after another lineage becomes authoritative', () => {
    const ledger = new TerminalRetirementLedger()
    const successor = { ...fact(1), terminalRuntimeSessionId: 'pty-successor' }
    const authoritative = { ...fact(1), terminalRuntimeSessionId: 'pty-authoritative' }
    ledger.record(successor, 'successor')

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [authoritative])

    expect(ledger.hasRetirement(successor)).toBe(true)
    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([])
  })

  test('retires a stale durable tombstone when a different binding becomes authoritative', () => {
    const ledger = new TerminalRetirementLedger()
    const generation1 = fact(1)
    const generation2 = { ...fact(1), terminalRuntimeGeneration: 2 }
    ledger.record(generation1, 'durable')

    ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [generation2])

    expect(ledger.hasRetirement(generation1)).toBe(false)
  })

  test('does not transfer unresolved foreign facts on absence', () => {
    const ledger = new TerminalRetirementLedger()
    const retirement = fact(1)
    ledger.record(retirement)

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([])
    expect(ledger.size()).toBe(0)
  })

  test('reconciles and retires only the requested workspace-runtime scope', () => {
    const ledger = new TerminalRetirementLedger()
    const repoA = fact(1)
    const repoB = {
      ...fact(2),
      workspaceId: WORKSPACE_B,
      workspaceRuntimeId: 'runtime-b',
    }
    ledger.record(repoA, 'successor')
    ledger.record(repoB)

    expect(ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [])).toEqual([repoA])
    expect(ledger.hasRetirement(repoB)).toBe(true)

    ledger.retireSnapshotScope(JSON.stringify([WORKSPACE_B, 'runtime-b']))
    expect(ledger.size()).toBe(0)
  })

  test('stays bounded across repeated future generations for one authoritative session', () => {
    const ledger = new TerminalRetirementLedger({ capacity: 2 })
    for (let generation = 1; generation <= 20; generation += 1) {
      const authoritative = { ...fact(1), terminalRuntimeGeneration: generation }
      ledger.record(authoritative)
      ledger.record({ ...fact(1), terminalRuntimeGeneration: generation + 100 })
      ledger.record({ ...fact(1), terminalRuntimeGeneration: generation + 200 })
      ledger.reconcileAuthoritativeSnapshot(SCOPE_A, [authoritative])
      expect(ledger.size()).toBeLessThanOrEqual(3)
    }
  })
})
