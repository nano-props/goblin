import { describe, expect, test } from 'vitest'
import {
  applyDisplayOrder,
  restoreDisplayOrder,
  snapshotDisplayOrder,
  terminalSessionDisplayOrder,
} from '#/web/components/terminal/terminal-session-display-order.ts'

describe('terminal session display order helpers', () => {
  test('derives display rank from persisted order or descriptor index fallback', () => {
    const orders = new Map([['terminal-2', 0]])
    expect(
      terminalSessionDisplayOrder(
        {
          key: 'terminal-2',
          worktreeTerminalKey: 'repo\0wt',
          terminalId: 'terminal-2',
          index: 2,
          repoRoot: '/repo',
          branch: 'main',
          worktreePath: '/repo',
        },
        orders,
      ),
    ).toBe(0)
    expect(
      terminalSessionDisplayOrder(
        {
          key: 'terminal-3',
          worktreeTerminalKey: 'repo\0wt',
          terminalId: 'terminal-3',
          index: 3,
          repoRoot: '/repo',
          branch: 'main',
          worktreePath: '/repo',
        },
        orders,
      ),
    ).toBe(2)
  })

  test('snapshots, applies, and restores optimistic reorder state', () => {
    const orders = new Map<string, number>([
      ['terminal-1', 1],
      ['terminal-2', 0],
    ])
    const previous = snapshotDisplayOrder(['terminal-1', 'terminal-2', 'terminal-3'], orders)
    applyDisplayOrder(orders, ['terminal-3', 'terminal-1', 'terminal-2'])
    expect(Array.from(orders.entries())).toEqual([
      ['terminal-1', 1],
      ['terminal-2', 2],
      ['terminal-3', 0],
    ])
    restoreDisplayOrder(orders, previous)
    expect(Array.from(orders.entries())).toEqual([
      ['terminal-1', 1],
      ['terminal-2', 0],
    ])
  })
})
