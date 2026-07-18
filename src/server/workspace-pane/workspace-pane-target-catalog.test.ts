import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneTargetCatalog } from '#/server/workspace-pane/workspace-pane-target-catalog.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

describe('WorkspacePaneTargetCatalog', () => {
  test('captures only identity data for a Git runtime', async () => {
    const readIdentities = vi.fn(async () => [
      { kind: 'git-worktree' as const, worktreePath: '/repo', head: { kind: 'branch' as const, branchName: 'main' } },
      { kind: 'git-branch' as const, branchName: 'feature/no-worktree' },
    ])
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readIdentities,
    })

    await expect(
      catalog.captureTargets('user-a', 'goblin+file:///repo', 'goblin+file:///repo\0runtime-a'),
    ).resolves.toEqual([
      {
        target: {
          kind: 'workspace-root',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
        },
        nativeWorktreePath: '/repo',
        canonicalBranch: null,
      },
      {
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          root: 'goblin+file:///repo',
        },
        nativeWorktreePath: '/repo',
        canonicalBranch: 'main',
      },
      {
        target: {
          kind: 'git-branch',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          branch: 'feature/no-worktree',
        },
        nativeWorktreePath: null,
        canonicalBranch: 'feature/no-worktree',
      },
    ])
    expect(readIdentities).toHaveBeenCalledOnce()
    expect(readIdentities).toHaveBeenCalledWith('goblin+file:///repo', { repoRuntimeId: 'runtime-a' })
  })

  test('does not query Git identity for a plain workspace runtime', async () => {
    const readIdentities = vi.fn()
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => false,
      readIdentities,
    })

    await expect(
      catalog.captureTargets('user-a', 'goblin+file:///repo', 'goblin+file:///repo\0runtime-a'),
    ).resolves.toHaveLength(1)
    expect(readIdentities).not.toHaveBeenCalled()
  })

  test('retains a detached worktree even when the repository has no branch refs', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readIdentities: async () => [
        { kind: 'git-worktree', worktreePath: '/repo', head: { kind: 'detached' } },
      ],
    })
    await expect(
      catalog.captureTargets('user-a', 'goblin+file:///repo', 'goblin+file:///repo\0runtime-a'),
    ).resolves.toEqual([
      {
        target: {
          kind: 'workspace-root',
          workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
          workspaceRuntimeId: 'runtime-a',
        },
        nativeWorktreePath: '/repo',
        canonicalBranch: null,
      },
      {
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          root: 'goblin+file:///repo',
        },
        nativeWorktreePath: '/repo',
        canonicalBranch: null,
      },
    ])
  })

})
