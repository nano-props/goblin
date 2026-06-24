import { describe, expect, test } from 'vitest'
import {
  restoreSlotDisplayOrder,
  slotSnapshotDisplayOrder,
  terminalSlotDisplayOrder,
} from '#/web/components/terminal/terminal-slot-display-order.ts'

describe('terminal slot display order helpers', () => {
  test('derives display rank from persisted order or descriptor index fallback', () => {
    const orders = new Map([['slot-2', 0]])
    expect(
      terminalSlotDisplayOrder(
        {
          key: 'slot-2',
          worktreeTerminalKey: 'repo\0wt',
          slotId: 'slot-2',
          index: 2,
          repoRoot: '/repo',
          branch: 'main',
          worktreePath: '/repo',
        },
        orders,
      ),
    ).toBe(0)
    expect(
      terminalSlotDisplayOrder(
        {
          key: 'slot-3',
          worktreeTerminalKey: 'repo\0wt',
          slotId: 'slot-3',
          index: 3,
          repoRoot: '/repo',
          branch: 'main',
          worktreePath: '/repo',
        },
        orders,
      ),
    ).toBe(2)
  })

  test('snapshots and restores optimistic reorder state', () => {
    const orders = new Map<string, number>([
      ['slot-1', 1],
      ['slot-2', 0],
    ])
    const previous = slotSnapshotDisplayOrder(['slot-1', 'slot-2', 'slot-3'], orders)
    orders.set('slot-3', 0)
    orders.set('slot-1', 1)
    orders.set('slot-2', 2)
    expect(Array.from(orders.entries())).toEqual([
      ['slot-1', 1],
      ['slot-2', 2],
      ['slot-3', 0],
    ])
    restoreSlotDisplayOrder(orders, previous)
    expect(Array.from(orders.entries())).toEqual([
      ['slot-1', 1],
      ['slot-2', 0],
    ])
  })
})
