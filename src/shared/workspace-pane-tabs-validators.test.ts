import * as v from 'valibot'
import { describe, expect, test } from 'vitest'
import { WorkspacePaneFilesystemExecutionTargetSchema } from '#/shared/workspace-pane-tabs-validators.ts'

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
