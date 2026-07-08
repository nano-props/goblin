import { describe, expect, test } from 'vitest'
import {
  isWorkspacePaneRuntimeTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabIdentity,
  workspacePaneRuntimeTabSessionId,
  workspacePaneStaticTabEntry,
  workspacePaneStaticTabId,
  workspacePaneTabEntryFromUnknown,
  workspacePaneTabEntryIdentity,
  workspacePaneTabsInsertAfterIdentity,
} from '#/shared/workspace-pane.ts'

describe('workspace pane runtime tab helpers', () => {
  test('normalizes terminal as the current runtime tab type', () => {
    const entry = workspacePaneRuntimeTabEntry('terminal', 'term-AAAAAAAAAAAAAAAAAAAAA')

    expect(entry).toEqual({ type: 'terminal', runtimeSessionId: 'term-AAAAAAAAAAAAAAAAAAAAA' })
    expect(isWorkspacePaneRuntimeTabType('terminal')).toBe(true)
    expect(workspacePaneRuntimeTabSessionId(entry)).toBe('term-AAAAAAAAAAAAAAAAAAAAA')
    expect(workspacePaneRuntimeTabIdentity('terminal', 'term-AAAAAAAAAAAAAAAAAAAAA')).toBe('terminal:term-AAAAAAAAAAAAAAAAAAAAA')
    expect(workspacePaneTabEntryIdentity(entry)).toBe('terminal:term-AAAAAAAAAAAAAAAAAAAAA')
  })

  test('parses runtime tab entries through the shared tab parser', () => {
    expect(workspacePaneTabEntryFromUnknown({ type: 'terminal', terminalSessionId: 'term-AAAAAAAAAAAAAAAAAAAAA' })).toBeNull()
    expect(workspacePaneTabEntryFromUnknown({ type: 'terminal', runtimeSessionId: 'term-AAAAAAAAAAAAAAAAAAAAA' })).toEqual(
      workspacePaneRuntimeTabEntry('terminal', 'term-AAAAAAAAAAAAAAAAAAAAA'),
    )
    expect(
      workspacePaneRuntimeTabSessionId({
        type: 'terminal',
        runtimeSessionId: 'term-AAAAAAAAAAAAAAAAAAAAA',
      }),
    ).toBe('term-AAAAAAAAAAAAAAAAAAAAA')
    expect(workspacePaneTabEntryFromUnknown({ type: 'terminal', terminalSessionId: '' })).toBeNull()
    expect(workspacePaneTabEntryFromUnknown({ type: 'terminal', runtimeSessionId: '' })).toBeNull()
  })
})

describe('workspacePaneTabsInsertAfterIdentity', () => {
  const status = workspacePaneStaticTabEntry('status')
  const changes = workspacePaneStaticTabEntry('changes')
  const history = workspacePaneStaticTabEntry('history')
  const files = workspacePaneStaticTabEntry('files')
  const termA = workspacePaneRuntimeTabEntry('terminal', 'term-AAAAAAAAAAAAAAAAAAAAA')
  const termB = workspacePaneRuntimeTabEntry('terminal', 'term-BBBBBBBBBBBBBBBBBBBBB')
  const termC = workspacePaneRuntimeTabEntry('terminal', 'term-CCCCCCCCCCCCCCCCCCCCC')

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
    const next = workspacePaneTabsInsertAfterIdentity(current, termC, 'terminal:term-AAAAAAAAAAAAAAAAAAAAA')
    expect(next).toEqual([status, termA, termC, files, termB])
  })

  test('inserts after the first tab when anchor matches position 0', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, history]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, workspacePaneStaticTabId('status'))
    expect(next).toEqual([status, changes, files, history])
  })

  test('inserts after the last tab when anchor matches the tail', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, termA]
    const next = workspacePaneTabsInsertAfterIdentity(current, changes, 'terminal:term-AAAAAAAAAAAAAAAAAAAAA')
    expect(next).toEqual([status, files, termA, changes])
  })

  test('appends to an empty list regardless of anchor', () => {
    expect(workspacePaneTabsInsertAfterIdentity([], status, null)).toEqual([status])
    expect(workspacePaneTabsInsertAfterIdentity([], status, workspacePaneStaticTabId('files'))).toEqual([status])
  })

  test('does not mutate the input list', () => {
    const current: WorkspacePaneTabEntry[] = [status, files, termA]
    const snapshot = [...current]
    workspacePaneTabsInsertAfterIdentity(current, changes, 'terminal:term-AAAAAAAAAAAAAAAAAAAAA')
    expect(current).toEqual(snapshot)
  })
})
