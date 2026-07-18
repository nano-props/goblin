import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneTargetCatalog } from '#/server/workspace-pane/workspace-pane-target-catalog.ts'

describe('WorkspacePaneTargetCatalog', () => {
  test('captures only identity data for a Git runtime', async () => {
    const readIdentities = vi.fn(async () => [
      { branch: 'main', worktreePath: '/repo' },
      { branch: 'feature/no-worktree', worktreePath: null },
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

  test('retains only the workspace root for a Git repo with no branch refs', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readIdentities: async () => [],
    })
    await expect(
      catalog.captureTargets('user-a', 'goblin+file:///repo', 'goblin+file:///repo\0runtime-a'),
    ).resolves.toEqual([
      {
        target: { kind: 'workspace-root', workspaceId: 'goblin+file:///repo', workspaceRuntimeId: 'runtime-a' },
        nativeWorktreePath: '/repo',
        canonicalBranch: null,
      },
    ])
  })

  test('rejects a branch rename between capture and admission with one narrow validation read', async () => {
    let identities = [{ branch: 'main', worktreePath: '/repo' }]
    const readIdentities = vi.fn(async () => identities)
    const catalog = new WorkspacePaneTargetCatalog({ hasGitCapability: () => true, readIdentities })
    const captured = await catalog.captureTargets('user-a', 'goblin+file:///repo', 'goblin+file:///repo\0runtime-a')
    identities = [{ branch: 'renamed', worktreePath: '/repo' }]
    await expect(
      catalog.validateTargets('user-a', 'goblin+file:///repo', 'goblin+file:///repo\0runtime-a', captured),
    ).resolves.toBe(false)
    expect(readIdentities).toHaveBeenCalledTimes(2)
  })
})
