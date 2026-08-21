import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { gitWorktreeFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///repo')

describe('workspace pane runtime tab target key', () => {
  test('formats the current runtime target key', () => {
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-1',
        filesystemTarget: gitWorktreeFilesystemExecutionTarget(REPO_ID, 'repo-runtime-1', '/repo-worktree'),
      }),
    ).toBe(formatTerminalFilesystemTargetKeyForPath(REPO_ID, '/repo-worktree'))
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-1',
        filesystemTarget: { kind: 'workspace-root', workspaceId: REPO_ID, workspaceRuntimeId: 'repo-runtime-1' },
      }),
    ).toBe(formatTerminalFilesystemTargetKeyForPath(REPO_ID, REPO_ID))
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-1',
        filesystemTarget: null,
      }),
    ).toBeNull()
  })

  test('rejects a filesystem target owned by a different runtime', () => {
    expect(
      workspacePaneRuntimeTabTargetKey({
        workspaceId: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-current',
        filesystemTarget: {
          kind: 'workspace-root',
          workspaceId: REPO_ID,
          workspaceRuntimeId: 'repo-runtime-stale',
        },
      }),
    ).toBeNull()
  })
})
