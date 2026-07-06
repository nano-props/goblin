import { describe, expect, test } from 'vitest'
import {
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneStaticTabId,
  workspacePaneTabsInsertAfterIdentity,
  workspacePaneTerminalTabEntry,
} from '#/shared/workspace-pane.ts'

describe('workspacePaneTabsInsertAfterIdentity', () => {
  const status = workspacePaneStaticTabEntry('status')
  const changes = workspacePaneStaticTabEntry('changes')
  const history = workspacePaneStaticTabEntry('history')
  const files = workspacePaneStaticTabEntry('files')
  const termA = workspacePaneTerminalTabEntry('session-A')
  const termB = workspacePaneTerminalTabEntry('session-B')
  const termC = workspacePaneTerminalTabEntry('session-C')

  test('appends when anchor is null', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, termA]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, null)
    expect(next).toEqual([status, files, termA, changes])
  })

  test('appends when anchor is undefined', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, termA]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes)
    expect(next).toEqual([status, files, termA, changes])
  })

  test('appends when anchor is an empty string', () => {
    const current: WorkspacePaneTabEntry[] = [status, files]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, '')
    expect(next).toEqual([status, files, changes])
  })

  test('appends when anchor is not in the list', () => {
    const current: WorkspacePaneTabEntry[] = [status, files]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, 'terminal:missing')
    expect(next).toEqual([status, files, changes])
  })

  test('inserts immediately to the right of a static anchor', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, history]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, workspacePaneStaticTabId('files'))
    expect(next).toEqual([status, files, changes, history])
  })

  test('inserts immediately to the right of a terminal anchor', () => {
    const current: WorkspacePaneTabEntry[] = [status, termA, files, termB]
    const next = workspacePaneTabsInsertAfterIdentity(current, termC, 'terminal:session-A')
    expect(next).toEqual([status, termA, termC, files, termB])
  })

  test('inserts after the first tab when anchor matches position 0', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, history]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, workspacePaneStaticTabId('status'))
    expect(next).toEqual([status, changes, files, history])
  })

  test('inserts after the last tab when anchor matches the tail', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, termA]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, 'terminal:session-A')
    expect(next).toEqual([status, files, termA, changes])
  })

  test('appends to an empty list regardless of anchor', () => {
    expect(workspacePaneTabsInsertAfterIdentity([], status, null)).toEqual([status])
    expect(workspacePaneTabsInsertAfterIdentity([], status, workspacePaneStaticTabId('files'))).toEqual([status])
  })

  test('does not mutate the input list', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, termA]
    const snapshot = [...current]
    workspacePaneTabsInsertAfterIdentity(current, changes, 'terminal:session-A')
    expect(current).toEqual(snapshot)
  })
})
