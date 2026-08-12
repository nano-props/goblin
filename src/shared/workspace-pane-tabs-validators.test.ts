import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import {
  isWorkspacePaneTabsUpdateOperation,
  normalizeWorkspacePaneTabsWriteResult,
  WorkspacePaneFilesystemExecutionTargetSchema,
} from '#/shared/workspace-pane-tabs-validators.ts'

describe('workspace pane tabs update operation schema', () => {
  test('accepts every supported operation shape', () => {
    expect(isWorkspacePaneTabsUpdateOperation({ type: 'open-static', tabType: 'history' })).toBe(true)
    expect(
      isWorkspacePaneTabsUpdateOperation({
        type: 'open-static',
        tabType: 'files',
        insertAfterIdentity: 'workspace-pane:history',
      }),
    ).toBe(true)
    expect(isWorkspacePaneTabsUpdateOperation({ type: 'close-static', tabType: 'changes' })).toBe(true)
    expect(
      isWorkspacePaneTabsUpdateOperation({
        type: 'reorder',
        tabIdentities: ['workspace-pane:files', 'workspace-pane:history'],
      }),
    ).toBe(true)
  })

  test('rejects unsupported tabs and invalid identities', () => {
    expect(isWorkspacePaneTabsUpdateOperation({ type: 'open-static', tabType: 'terminal' })).toBe(false)
    expect(
      isWorkspacePaneTabsUpdateOperation({
        type: 'open-static',
        tabType: 'history',
        insertAfterIdentity: '',
      }),
    ).toBe(false)
    expect(isWorkspacePaneTabsUpdateOperation({ type: 'reorder', tabIdentities: ['bad\0identity'] })).toBe(false)
    expect(isWorkspacePaneTabsUpdateOperation({ type: 'reorder', tabIdentities: new Array(1) })).toBe(false)
    expect(isWorkspacePaneTabsUpdateOperation({ type: 'unsupported' })).toBe(false)
  })
})

describe('workspace pane tabs write result schema', () => {
  test('preserves projected and committed projection failure outcomes', () => {
    expect(
      normalizeWorkspacePaneTabsWriteResult({ kind: 'projected', snapshot: { revision: 2, entries: [] } }),
    ).toEqual({ kind: 'projected', snapshot: { revision: 2, entries: [] } })
    expect(normalizeWorkspacePaneTabsWriteResult({ kind: 'committed-projection-failed' })).toEqual({
      kind: 'committed-projection-failed',
    })
  })

  test('rejects a bare snapshot at the write protocol boundary', () => {
    expect(normalizeWorkspacePaneTabsWriteResult({ revision: 2, entries: [] })).toBeNull()
  })
})

describe('workspace pane filesystem execution target schema', () => {
  test('rejects a Git worktree on another execution transport', () => {
    expect(
      v.safeParse(WorkspacePaneFilesystemExecutionTargetSchema, {
        kind: 'git-worktree',
        workspaceId: 'goblin+ssh://mock-host/workspace',
        workspaceRuntimeId: 'runtime-current',
        root: 'goblin+ssh://mock-host/workspace-linked',
      }).success,
    ).toBe(true)
    expect(
      v.safeParse(WorkspacePaneFilesystemExecutionTargetSchema, {
        kind: 'git-worktree',
        workspaceId: 'goblin+ssh://mock-host/workspace',
        workspaceRuntimeId: 'runtime-current',
        root: 'goblin+ssh://other-mock-host/workspace-linked',
      }).success,
    ).toBe(false)
  })
})
