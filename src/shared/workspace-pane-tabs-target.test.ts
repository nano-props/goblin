import { describe, expect, it } from 'vitest'
import {
  parseRestorableWorkspacePaneTargetKey,
  restorableWorkspacePaneTarget,
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
} from '#/shared/workspace-pane-tabs-target.ts'

describe('restorable workspace pane targets', () => {
  it('does not duplicate workspace identity or runtime identity in persisted keys', () => {
    expect(restorableWorkspacePaneTargetKey({ kind: 'workspace' })).toBe('workspace')
    expect(restorableWorkspacePaneTargetKey({ kind: 'git-branch', branch: 'feature/a' })).toBe(
      'git-branch\0feature/a',
    )
  })

  it('stores worktree roots as canonical locators and binds them to native runtime paths', () => {
    const workspaceId = 'goblin+ssh://server/srv/app'
    const runtime = { repoRoot: workspaceId, branchName: 'feature/a', worktreePath: '/srv/app-feature' }
    const restorable = restorableWorkspacePaneTarget(runtime)
    expect(restorable).toEqual({ kind: 'git-worktree', root: 'goblin+ssh://server/srv/app-feature' })
    const key = restorableWorkspacePaneTargetKey(restorable!)
    expect(parseRestorableWorkspacePaneTargetKey(key)).toEqual(restorable)
    expect(workspacePaneTabsTargetFromRestorable(workspaceId, restorable!)).toEqual({
      repoRoot: workspaceId,
      branchName: '',
      worktreePath: '/srv/app-feature',
    })
  })

  it('rejects legacy keys that duplicate a workspace id or contain raw worktree paths', () => {
    expect(parseRestorableWorkspacePaneTargetKey('goblin+file:///repo\0branch\0main')).toBeNull()
    expect(parseRestorableWorkspacePaneTargetKey('git-worktree\0/tmp/worktree')).toBeNull()
  })
})
