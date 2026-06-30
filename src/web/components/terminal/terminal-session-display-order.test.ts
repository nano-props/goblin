import { describe, expect, test } from 'vitest'
import {
  restoreSessionDisplayOrder,
  sessionSnapshotDisplayOrder,
  terminalSessionDisplayOrder,
} from '#/web/components/terminal/terminal-session-display-order.ts'

describe('terminal session display order helpers', () => {
  test('derives display rank from persisted order or descriptor index fallback', () => {
    const orders = new Map([['session-2', 0]])
    expect(
      terminalSessionDisplayOrder(
        {
          terminalKey: 'session-2',
          worktreeTerminalKey: 'repo\0wt',
          sessionId: 'session-2',
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
          terminalKey: 'session-3',
          worktreeTerminalKey: 'repo\0wt',
          sessionId: 'session-3',
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
      ['session-1', 1],
      ['session-2', 0],
    ])
    const previous = sessionSnapshotDisplayOrder(['session-1', 'session-2', 'session-3'], orders)
    orders.set('session-3', 0)
    orders.set('session-1', 1)
    orders.set('session-2', 2)
    expect(Array.from(orders.entries())).toEqual([
      ['session-1', 1],
      ['session-2', 2],
      ['session-3', 0],
    ])
    restoreSessionDisplayOrder(orders, previous)
    expect(Array.from(orders.entries())).toEqual([
      ['session-1', 1],
      ['session-2', 0],
    ])
  })
})
