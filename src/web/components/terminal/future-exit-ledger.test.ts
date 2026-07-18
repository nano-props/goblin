import { describe, expect, test } from 'vitest'
import { FutureExitLedger, type FutureExitBinding } from '#/web/components/terminal/future-exit-ledger.ts'

function binding(index: number): FutureExitBinding {
  return {
    terminalSessionId: `term-${index}`,
    terminalRuntimeSessionId: `pty-${index}`,
    terminalRuntimeGeneration: 1,
    repoRoot: '/repo-a',
    workspaceRuntimeId: 'repo-runtime-a-1',
  }
}

describe('FutureExitLedger', () => {
  test('bounds unknown orphan exits without dropping the newest correlations', () => {
    const ledger = new FutureExitLedger({ capacity: 3 })
    for (let index = 0; index < 10; index += 1) ledger.record(binding(index))

    expect(ledger.size()).toBe(3)
    expect(ledger.blocksActivation(binding(7))).toBe(true)
    expect(ledger.blocksActivation(binding(9))).toBe(true)
    expect(ledger.blocksActivation(binding(0))).toBe(false)
  })

  test('deduplicates a long stream of repeated unknown sibling create-exit events', () => {
    const ledger = new FutureExitLedger({ capacity: 4 })
    for (let index = 0; index < 1_000; index += 1) ledger.record(binding(1))
    expect(ledger.size()).toBe(1)
    expect(ledger.blocksActivation(binding(1))).toBe(true)
  })

  test('expires orphan correlations after TTL', () => {
    let now = 0
    const ledger = new FutureExitLedger({ ttlMs: 50, now: () => now })
    ledger.record(binding(1))
    now = 50
    expect(ledger.blocksActivation(binding(1))).toBe(false)
    expect(ledger.size()).toBe(0)
  })

  test('keeps an authoritative tombstone beyond the orphan TTL', () => {
    let now = 0
    const ledger = new FutureExitLedger({ ttlMs: 50, now: () => now })
    ledger.record(binding(1), 'durable')
    now = 5_000
    expect(ledger.blocksActivation(binding(1))).toBe(true)
  })

  test('promotes a present orphan to a durable tombstone', () => {
    let now = 0
    const ledger = new FutureExitLedger({ ttlMs: 50, now: () => now })
    ledger.record(binding(1))
    ledger.confirmAuthoritativeSnapshot(
      JSON.stringify(['/repo-a', 'repo-runtime-a-1']),
      [binding(1)],
    )
    now = 5_000
    expect(ledger.blocksActivation(binding(1))).toBe(true)
  })

  test('does not evict durable tombstones under orphan capacity pressure', () => {
    const ledger = new FutureExitLedger()
    const authoritative = binding(1)
    ledger.record(authoritative, 'durable')
    for (let index = 2; index < 302; index += 1) ledger.record(binding(index))

    expect(ledger.blocksActivation(authoritative)).toBe(true)
    expect(ledger.size()).toBe(257)
    expect(ledger.blocksActivation(binding(45))).toBe(false)
    expect(ledger.blocksActivation(binding(301))).toBe(true)
  })

  test('clears a durable tombstone after authoritative absence', () => {
    const ledger = new FutureExitLedger()
    ledger.record(binding(1), 'durable')
    ledger.confirmAuthoritativeSnapshot(
      JSON.stringify(['/repo-a', 'repo-runtime-a-1']),
      [],
    )
    expect(ledger.blocksActivation(binding(1))).toBe(false)
  })

  test('retires only orphan exits owned by the replaced repo epoch', () => {
    const ledger = new FutureExitLedger()
    const repoA = binding(1)
    const repoB = {
      ...binding(2),
      repoRoot: '/repo-b',
      workspaceRuntimeId: 'repo-runtime-b-1',
    }
    ledger.record(repoA)
    ledger.record(repoB)

    ledger.retireSnapshotScope(JSON.stringify(['/repo-a', 'repo-runtime-a-1']))
    expect(ledger.size()).toBe(1)
    expect(ledger.blocksActivation(repoA)).toBe(false)
    expect(ledger.blocksActivation(repoB)).toBe(true)
  })

  test('keeps a present exit as an exact activation tombstone', () => {
    const ledger = new FutureExitLedger()
    ledger.record(binding(1))
    ledger.confirmAuthoritativeSnapshot(
      JSON.stringify(['/repo-a', 'repo-runtime-a-1']),
      [binding(1)],
    )
    expect(ledger.blocksActivation(binding(1))).toBe(true)
    expect(ledger.blocksActivation(binding(1))).toBe(true)
  })

  test('checking one generation preserves every exact generation tombstone', () => {
    const ledger = new FutureExitLedger()
    const generation2 = { ...binding(1), terminalRuntimeGeneration: 2 }
    const generation3 = { ...binding(1), terminalRuntimeGeneration: 3 }
    ledger.record(generation2)
    ledger.record(generation3)

    expect(ledger.blocksActivation(generation2)).toBe(true)
    expect(ledger.blocksActivation(generation3)).toBe(true)
  })

  test('clears an absent orphan only from its exact authoritative snapshot scope', () => {
    const ledger = new FutureExitLedger()
    const repoA = binding(1)
    const repoB = {
      ...binding(2),
      repoRoot: '/repo-b',
      workspaceRuntimeId: 'repo-runtime-b-1',
    }
    ledger.record(repoA)
    ledger.record(repoB)

    ledger.confirmAuthoritativeSnapshot(
      JSON.stringify(['/repo-a', 'repo-runtime-a-1']),
      [],
    )
    expect(ledger.blocksActivation(repoA)).toBe(false)
    expect(ledger.blocksActivation(repoB)).toBe(true)
  })

  test('promotes only the exact authoritative binding for a durable session', () => {
    let now = 0
    const ledger = new FutureExitLedger({ ttlMs: 50, now: () => now })
    const generation1 = binding(1)
    const generation2 = { ...binding(1), terminalRuntimeGeneration: 2 }
    ledger.record(generation1)
    ledger.record(generation2)

    ledger.confirmAuthoritativeSnapshot(JSON.stringify(['/repo-a', 'repo-runtime-a-1']), [generation1])
    now = 50

    expect(ledger.blocksActivation(generation1)).toBe(true)
    expect(ledger.blocksActivation(generation2)).toBe(false)
  })

  test('retires an older durable tombstone when the authoritative binding changes', () => {
    const ledger = new FutureExitLedger()
    const generation1 = binding(1)
    const generation2 = { ...binding(1), terminalRuntimeGeneration: 2 }
    ledger.record(generation1, 'durable')

    ledger.confirmAuthoritativeSnapshot(JSON.stringify(['/repo-a', 'repo-runtime-a-1']), [generation2])

    expect(ledger.blocksActivation(generation1)).toBe(false)
    expect(ledger.blocksActivation(generation2)).toBe(false)
  })

  test('stays bounded across repeated future lineages for one authoritative session', () => {
    const ledger = new FutureExitLedger({ capacity: 2 })
    const scope = JSON.stringify(['/repo-a', 'repo-runtime-a-1'])
    for (let generation = 1; generation <= 20; generation += 1) {
      const authoritative = { ...binding(1), terminalRuntimeGeneration: generation }
      ledger.record(authoritative)
      ledger.record({ ...binding(1), terminalRuntimeGeneration: generation + 100 })
      ledger.record({ ...binding(1), terminalRuntimeGeneration: generation + 200 })
      ledger.confirmAuthoritativeSnapshot(scope, [authoritative])
      expect(ledger.size()).toBeLessThanOrEqual(3)
    }
  })
})
