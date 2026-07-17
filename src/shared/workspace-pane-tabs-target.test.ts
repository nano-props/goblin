import { describe, expect, it } from 'vitest'
import {
  parseRestorableWorkspacePaneTargetKey,
  restorableWorkspacePaneTarget,
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
  workspacePaneTabsTargetFromRuntime,
} from '#/shared/workspace-pane-tabs-target.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

describe('restorable workspace pane targets', () => {
  it('does not duplicate workspace identity or runtime identity in persisted keys', () => {
    expect(restorableWorkspacePaneTargetKey({ kind: 'workspace' })).toBe('workspace')
    expect(restorableWorkspacePaneTargetKey({ kind: 'git-branch', branch: 'feature/a' })).toBe('git-branch\0feature/a')
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

  it('decodes canonical Windows worktree locators without consulting the browser platform', () => {
    const target = {
      kind: 'git-worktree' as const,
      root: canonicalWorkspaceLocator('goblin+file:///C:/repo/worktree')!,
    }
    expect(parseRestorableWorkspacePaneTargetKey(restorableWorkspacePaneTargetKey(target))).toEqual(target)
    expect(workspacePaneTabsTargetFromRestorable('goblin+file:///C:/repo', target)).toEqual({
      repoRoot: 'goblin+file:///C:/repo',
      branchName: '',
      worktreePath: 'C:\\repo\\worktree',
    })
  })

  it('rejects worktree targets from a different transport or SSH profile', () => {
    const workspaceRuntimeId = 'repo-runtime-test'
    expect(
      workspacePaneTabsTargetFromRuntime({
        kind: 'git-worktree',
        workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
        workspaceRuntimeId,
        root: canonicalWorkspaceLocator('goblin+ssh://server/repo/worktree')!,
      }),
    ).toBeNull()
    expect(
      workspacePaneTabsTargetFromRuntime({
        kind: 'git-worktree',
        workspaceId: canonicalWorkspaceLocator('goblin+ssh://server-a/repo')!,
        workspaceRuntimeId,
        root: canonicalWorkspaceLocator('goblin+ssh://server-b/repo/worktree')!,
      }),
    ).toBeNull()
  })
})
