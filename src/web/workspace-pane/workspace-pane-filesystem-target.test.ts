import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneFilesystemRuntimeTarget,
  workspacePaneFilesystemRootPath,
  workspaceRootPaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const FILESYSTEM_CAPABILITIES = {
  files: { read: true as const, write: true as const },
  terminal: { available: true as const },
  git: { status: 'unavailable' as const },
}

const GIT_FILESYSTEM_CAPABILITIES = {
  ...FILESYSTEM_CAPABILITIES,
  git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
}

describe('workspace pane filesystem target', () => {
  test('derives the native root path from the canonical Workspace identity', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/example')
    const target = workspaceRootPaneFilesystemTarget({
      workspaceId,
      workspaceRuntimeId: 'workspace-runtime-example',
      capabilities: FILESYSTEM_CAPABILITIES,
    })

    expect(workspacePaneFilesystemRootPath(target)).toBe('/workspace/example')
    expect(workspacePaneFilesystemRuntimeTarget(target)).toEqual({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: 'workspace-runtime-example',
    })
  })

  test('admits a Git worktree only when it shares the Workspace transport', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://host-a/workspace/example')

    expect(() =>
      gitWorktreePaneFilesystemTarget({
        workspaceId,
        workspaceRuntimeId: 'workspace-runtime-example',
        worktreePath: '/workspace/example-feature',
        head: { kind: 'branch', branchName: 'feature/example' },
        capabilities: GIT_FILESYSTEM_CAPABILITIES,
      }),
    ).not.toThrow()
    expect(() =>
      gitWorktreePaneFilesystemTarget({
        workspaceId,
        workspaceRuntimeId: 'workspace-runtime-example',
        worktreePath: 'goblin+ssh://host-b/workspace/example-feature',
        head: { kind: 'branch', branchName: 'feature/example' },
        capabilities: GIT_FILESYSTEM_CAPABILITIES,
      }),
    ).toThrow('Git worktree target must share the Workspace transport')
  })
})
