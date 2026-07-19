import { describe, expect, it } from 'vitest'
import {
  parseRestorableWorkspacePaneTargetKey,
  parseWorkspacePaneTabsTargetIdentityKey,
  restorableWorkspacePaneTarget,
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('restorable workspace pane targets', () => {
  it('does not duplicate workspace identity or runtime identity in persisted keys', () => {
    expect(restorableWorkspacePaneTargetKey({ kind: 'workspace-root' })).toBe('workspace-root')
    expect(restorableWorkspacePaneTargetKey({ kind: 'git-branch', branch: 'feature/a' })).toBe('git-branch\0feature/a')
  })

  it('stores worktree roots as canonical locators and binds them to native runtime paths', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://server/srv/app')
    const runtime = {
      kind: 'git-worktree' as const,
      workspaceId: workspaceId,
      worktreePath: '/srv/app-feature',
    }
    const restorable = restorableWorkspacePaneTarget(runtime)
    expect(restorable).toEqual({ kind: 'git-worktree', root: 'goblin+ssh://server/srv/app-feature' })
    const key = restorableWorkspacePaneTargetKey(restorable!)
    expect(parseRestorableWorkspacePaneTargetKey(key)).toEqual(restorable)
    expect(workspacePaneTabsTargetFromRestorable(workspaceId, restorable!)).toEqual({
      kind: 'git-worktree',
      workspaceId: workspaceId,
      worktreePath: '/srv/app-feature',
    })
  })

  it('rejects legacy keys that duplicate a workspace id or contain raw worktree paths', () => {
    expect(parseRestorableWorkspacePaneTargetKey('goblin+file:///repo\0branch\0main')).toBeNull()
    expect(parseRestorableWorkspacePaneTargetKey('git-worktree\0/tmp/worktree')).toBeNull()
  })

  it('uses strict canonical identities for client target keys', () => {
    const key = workspacePaneTabsTargetIdentityKey({
      kind: 'git-worktree',
      workspaceId: workspaceIdForTest('goblin+ssh://server/srv/app'),
      worktreePath: '/srv/app-feature',
    })
    expect(key).toBe('goblin+ssh://server/srv/app\0worktree\0goblin+ssh://server/srv/app-feature')
    expect(parseWorkspacePaneTabsTargetIdentityKey(key)).toEqual({
      kind: 'worktree',
      workspaceId: 'goblin+ssh://server/srv/app',
      worktreeId: 'goblin+ssh://server/srv/app-feature',
    })
    expect(parseWorkspacePaneTabsTargetIdentityKey('goblin+file:///repo\0worktree\0/tmp/worktree')).toBeNull()
    expect(
      parseWorkspacePaneTabsTargetIdentityKey(
        'goblin+ssh://server/srv/app\0worktree\0goblin+ssh://other/srv/app-feature',
      ),
    ).toBeNull()
    expect(parseWorkspacePaneTabsTargetIdentityKey('/repo\0workspace-root')).toBeNull()
    expect(parseWorkspacePaneTabsTargetIdentityKey('goblin+file:///repo\0branch\0bad\nbranch')).toBeNull()
  })

  it('decodes canonical Windows worktree locators without consulting the browser platform', () => {
    const target = {
      kind: 'git-worktree' as const,
      root: workspaceIdForTest('goblin+file:///C:/repo/worktree'),
    }
    expect(parseRestorableWorkspacePaneTargetKey(restorableWorkspacePaneTargetKey(target))).toEqual(target)
    expect(workspacePaneTabsTargetFromRestorable(workspaceIdForTest('goblin+file:///C:/repo'), target)).toEqual({
      kind: 'git-worktree',
      workspaceId: 'goblin+file:///C:/repo',
      worktreePath: 'C:\\repo\\worktree',
    })
  })

  it('rejects worktree targets from a different transport or SSH profile', () => {
    const workspaceRuntimeId = 'repo-runtime-test'
    expect(
      workspacePaneTabsTargetFromRuntime({
        kind: 'git-worktree',
        workspaceId: workspaceIdForTest('goblin+file:///repo'),
        workspaceRuntimeId,
        root: workspaceIdForTest('goblin+ssh://server/repo/worktree'),
      }),
    ).toBeNull()
    expect(
      workspacePaneTabsTargetFromRuntime({
        kind: 'git-worktree',
        workspaceId: workspaceIdForTest('goblin+ssh://server-a/repo'),
        workspaceRuntimeId,
        root: workspaceIdForTest('goblin+ssh://server-b/repo/worktree'),
      }),
    ).toBeNull()
  })
})
