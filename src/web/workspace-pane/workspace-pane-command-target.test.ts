import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  workspacePaneCommandCoordinates,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'

const filesystemTarget = {
  kind: 'git-worktree' as const,
  workspaceId: workspaceIdForTest('goblin+file:///tmp/command-target-repo'),
  workspaceRuntimeId: 'repo-runtime-command-target',
  rootPath: '/tmp/command-target-worktree',
  head: { kind: 'branch' as const, branchName: 'feature/example' },
  capabilities: {
    files: { read: true as const, write: true as const },
    terminal: { available: true as const },
    git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
  },
}

describe('workspace pane command target', () => {
  test('derives the worktree branch presentation from its single Git head authority', () => {
    const target: WorkspacePaneCommandTarget = {
      kind: 'git-worktree',
      workspacePaneRoute: null,
      filesystemTarget,
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBe('feature/example')
  })

  test('derives a detached presentation without a parallel nullable branch field', () => {
    const target: WorkspacePaneCommandTarget = {
      kind: 'git-worktree',
      workspacePaneRoute: null,
      filesystemTarget: { ...filesystemTarget, head: { kind: 'detached' } },
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBeNull()
  })

  test('does not admit a contradictory worktree branch field', () => {
    const target: WorkspacePaneCommandTarget = {
      kind: 'git-worktree',
      workspacePaneRoute: null,
      filesystemTarget,
      // @ts-expect-error A worktree branch is derived exclusively from filesystemTarget.head.
      branchName: 'feature/conflicting',
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBe('feature/example')
  })
})
