import { describe, expect, test } from 'vitest'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  orderWorkspacePaneItemsByTabEntries,
  workspacePaneTabsWithDraggedOrder,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

describe('orderWorkspacePaneItemsByTabEntries', () => {
  test('orders materialized items by tab entries without creating missing items', () => {
    const terminalOne = terminalEntry('session-1')
    const terminalTwo = terminalEntry('session-2')
    const status = staticEntry('status')
    const items = [
      item('terminal-1', terminalOne),
      item('pending', null),
      item('status', status),
      item('terminal-2', terminalTwo),
    ]

    const ordered = orderWorkspacePaneItemsByTabEntries(
      items,
      [status, terminalTwo],
      (candidate) => candidate.entry,
    )

    expect(ordered.map((candidate) => candidate.key)).toEqual([
      'status',
      'terminal-2',
      'terminal-1',
      'pending',
    ])
  })
})

describe('workspacePaneTabsWithDraggedOrder', () => {
  test('reorders current tabs by dragged tabs while preserving tabs absent from the drag snapshot', () => {
    const terminalOne = terminalEntry('session-1')
    const status = staticEntry('status')
    const history = staticEntry('history')

    expect(workspacePaneTabsWithDraggedOrder([terminalOne, status, history], [status, terminalOne])).toEqual([
      status,
      terminalOne,
      history,
    ])
  })
})

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneTerminalTabEntry(sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

function item(key: string, entry: WorkspacePaneTabEntry | null): { key: string; entry: WorkspacePaneTabEntry | null } {
  return { key, entry }
}
