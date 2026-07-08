import { describe, expect, test } from 'vitest'
import { workspacePaneStaticTabEntry, workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  orderWorkspacePaneItemsByTabEntries,
  workspacePaneTabsWithoutStaticTab,
  workspacePaneTabsWithDraggedOrder,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

describe('orderWorkspacePaneItemsByTabEntries', () => {
  test('orders materialized items by tab entries without creating missing items', () => {
    const terminalOne = terminalEntry('term-111111111111111111111')
    const terminalTwo = terminalEntry('term-222222222222222222222')
    const status = staticEntry('status')
    const items = [
      item('terminal-1', terminalOne),
      item('pending', null),
      item('status', status),
      item('terminal-2', terminalTwo),
    ]

    const ordered = orderWorkspacePaneItemsByTabEntries(items, [status, terminalTwo], (candidate) => candidate.entry)

    expect(ordered.map((candidate) => candidate.key)).toEqual(['status', 'terminal-2', 'terminal-1', 'pending'])
  })
})

describe('workspacePaneTabsWithDraggedOrder', () => {
  test('reorders current tabs by dragged tabs while preserving tabs absent from the drag snapshot', () => {
    const terminalOne = terminalEntry('term-111111111111111111111')
    const status = staticEntry('status')
    const history = staticEntry('history')

    expect(workspacePaneTabsWithDraggedOrder([terminalOne, status, history], [status, terminalOne])).toEqual([
      status,
      terminalOne,
      history,
    ])
  })
})

describe('workspacePaneTabsWithoutStaticTab', () => {
  test('allows closing the final tab', () => {
    expect(workspacePaneTabsWithoutStaticTab([staticEntry('status')], 'status')).toEqual([])
  })
})

function terminalEntry(sessionId: string): WorkspacePaneTabEntry {
  return workspacePaneRuntimeTabEntry('terminal', sessionId)
}

function staticEntry(type: Parameters<typeof workspacePaneStaticTabEntry>[0]): WorkspacePaneTabEntry {
  return workspacePaneStaticTabEntry(type)
}

function item(key: string, entry: WorkspacePaneTabEntry | null): { key: string; entry: WorkspacePaneTabEntry | null } {
  return { key, entry }
}
