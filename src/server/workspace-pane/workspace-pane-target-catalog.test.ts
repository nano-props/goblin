import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneTargetCatalog } from '#/server/workspace-pane/workspace-pane-target-catalog.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')

describe('WorkspacePaneTargetCatalog', () => {
  test('captures only identity data for a Git runtime', async () => {
    const readMembership = vi.fn(async () => ({
      source: {
        kind: 'worktree' as const,
        identity: {
          kind: 'git-worktree' as const,
          worktreePath: '/repo',
          head: { kind: 'branch' as const, branchName: 'main' },
          materializedBranch: 'main',
        },
      },
      linkedWorktrees: [],
      branches: [{ kind: 'git-branch' as const, branchName: 'feature/no-worktree' }],
    }))
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readMembership,
    })

    await expect(catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')).resolves.toEqual([
      {
        target: {
          kind: 'workspace-root',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
        },
        nativeWorktreePath: '/repo',
      },
      {
        target: {
          kind: 'git-branch',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          branch: 'feature/no-worktree',
        },
        nativeWorktreePath: null,
      },
    ])
    expect(readMembership).toHaveBeenCalledOnce()
    expect(readMembership).toHaveBeenCalledWith('goblin+file:///repo', { workspaceRuntimeId: 'runtime-a' })
  })

  test('does not query Git identity for a plain workspace runtime', async () => {
    const readMembership = vi.fn()
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => false,
      readMembership,
    })

    await expect(
      catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a'),
    ).resolves.toHaveLength(1)
    expect(readMembership).not.toHaveBeenCalled()
  })

  test('retains a detached worktree even when the repository has no branch refs', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readMembership: async () => ({
        source: {
          kind: 'worktree',
          identity: {
            kind: 'git-worktree',
            worktreePath: '/repo',
            head: { kind: 'detached' },
            materializedBranch: null,
          },
        },
        linkedWorktrees: [],
        branches: [],
      }),
    })
    await expect(catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')).resolves.toEqual([
      {
        target: {
          kind: 'workspace-root',
          workspaceId: canonicalWorkspaceLocator('goblin+file:///repo')!,
          workspaceRuntimeId: 'runtime-a',
        },
        nativeWorktreePath: '/repo',
      },
    ])
  })

  test('retains the canonical target for a detached worktree', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readMembership: async () => ({
        source: {
          kind: 'worktree',
          identity: {
            kind: 'git-worktree',
            worktreePath: '/repo',
            head: { kind: 'detached' },
            materializedBranch: 'feature/in-progress',
          },
        },
        linkedWorktrees: [],
        branches: [],
      }),
    })

    const targets = await catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')

    expect(targets).toHaveLength(1)
  })

  test('uses the logical workspace for source and exposes only linked worktrees as Git targets', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      hasGitCapability: () => true,
      readMembership: async () => ({
        source: {
          kind: 'worktree',
          identity: {
            kind: 'git-worktree',
            worktreePath: '/physical/repo',
            head: { kind: 'branch', branchName: 'main' },
            materializedBranch: 'main',
          },
        },
        linkedWorktrees: [
          {
            kind: 'git-worktree',
            worktreePath: '/worktrees/feature',
            head: { kind: 'branch', branchName: 'feature/linked' },
            materializedBranch: 'feature/linked',
          },
        ],
        branches: [],
      }),
    })

    await expect(catalog.captureTargets('user-a', WORKSPACE_ID, `${WORKSPACE_ID}\0runtime-a`)).resolves.toEqual([
      {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'runtime-a' },
        nativeWorktreePath: '/repo',
      },
      {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'runtime-a',
          root: 'goblin+file:///worktrees/feature',
        },
        nativeWorktreePath: '/worktrees/feature',
      },
    ])
  })
})
