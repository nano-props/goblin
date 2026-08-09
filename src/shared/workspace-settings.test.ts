import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  parseWorkspaceExternalAppRecentKey,
  workspaceExternalAppRecentKey,
  workspaceExternalAppTargetForWorktree,
} from '#/shared/workspace-settings.ts'

describe('workspace external app target persistence', () => {
  test('round-trips workspace-root and Git worktree target identities', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://host-a/workspace/example')
    const worktreeTarget = workspaceExternalAppTargetForWorktree(workspaceId, '/workspace/example-feature')
    if (!worktreeTarget) throw new Error('invalid test worktree target')

    expect(parseWorkspaceExternalAppRecentKey(workspaceId, 'workspace-root')).toEqual({ kind: 'workspace-root' })
    expect(parseWorkspaceExternalAppRecentKey(workspaceId, workspaceExternalAppRecentKey(worktreeTarget))).toEqual(
      worktreeTarget,
    )
  })

  test('rejects branches, native paths, and worktrees from another transport', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://host-a/workspace/example')

    expect(parseWorkspaceExternalAppRecentKey(workspaceId, 'git-branch\0main')).toBeNull()
    expect(parseWorkspaceExternalAppRecentKey(workspaceId, '/workspace/example-feature')).toBeNull()
    expect(
      parseWorkspaceExternalAppRecentKey(workspaceId, 'git-worktree\0goblin+ssh://host-b/workspace/example-feature'),
    ).toBeNull()
  })
})
