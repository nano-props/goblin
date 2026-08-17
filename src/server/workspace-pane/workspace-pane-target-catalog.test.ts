import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneTargetCatalog } from '#/server/workspace-pane/workspace-pane-target-catalog.ts'
import { WorkspaceRuntimeStaleError } from '#/server/workspaces/runtime/authority.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')

describe('WorkspacePaneTargetCatalog', () => {
  test('captures only identity data for a Git runtime', async () => {
    const readIdentities = vi.fn(async () => [
      {
        kind: 'git-worktree' as const,
        worktreePath: '/repo',
        isWorkspaceRoot: true,
        head: { kind: 'branch' as const, branchName: 'main' },
        materializedBranch: 'main',
      },
      { kind: 'git-branch' as const, branchName: 'feature/no-worktree' },
    ])
    const catalog = new WorkspacePaneTargetCatalog({
      gitCapabilityState: () => 'available',
      readIdentities,
    })

    await expect(catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')).resolves.toEqual([
      {
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          root: 'goblin+file:///repo',
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
    expect(readIdentities).toHaveBeenCalledOnce()
    expect(readIdentities).toHaveBeenCalledWith('goblin+file:///repo', { workspaceRuntimeId: 'runtime-a' })
  })

  test('does not query Git identity for a plain workspace runtime', async () => {
    const readIdentities = vi.fn()
    const catalog = new WorkspacePaneTargetCatalog({
      gitCapabilityState: () => 'unavailable',
      readIdentities,
    })

    await expect(
      catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a'),
    ).resolves.toHaveLength(1)
    expect(readIdentities).not.toHaveBeenCalled()
  })

  test('fast-fails target capture while Git capability is transitioning', async () => {
    const readIdentities = vi.fn()
    const catalog = new WorkspacePaneTargetCatalog({
      gitCapabilityState: () => 'transitioning',
      readIdentities,
    })

    await expect(
      catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a'),
    ).rejects.toBeInstanceOf(WorkspaceRuntimeStaleError)
    expect(readIdentities).not.toHaveBeenCalled()
  })

  test('retains a detached worktree even when the repository has no branch refs', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      gitCapabilityState: () => 'available',
      readIdentities: async () => [
        {
          kind: 'git-worktree',
          worktreePath: '/repo',
          isWorkspaceRoot: true,
          head: { kind: 'detached' },
          materializedBranch: null,
        },
      ],
    })
    await expect(catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')).resolves.toEqual([
      {
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          root: 'goblin+file:///repo',
        },
        nativeWorktreePath: '/repo',
      },
    ])
  })

  test('maps a physical source worktree path alias to the logical workspace root', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      gitCapabilityState: () => 'available',
      readIdentities: async () => [
        {
          kind: 'git-worktree' as const,
          worktreePath: '/physical/repo',
          isWorkspaceRoot: true,
          head: { kind: 'branch' as const, branchName: 'feature' },
          materializedBranch: 'feature',
        },
      ],
    })

    await expect(catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')).resolves.toEqual([
      {
        target: {
          kind: 'git-worktree',
          workspaceId: 'goblin+file:///repo',
          workspaceRuntimeId: 'runtime-a',
          root: canonicalWorkspaceLocator('goblin+file:///repo')!,
        },
        nativeWorktreePath: '/physical/repo',
      },
    ])
  })

  test('retains the canonical target for a detached worktree', async () => {
    const catalog = new WorkspacePaneTargetCatalog({
      gitCapabilityState: () => 'available',
      readIdentities: async () => [
        {
          kind: 'git-worktree',
          worktreePath: '/repo',
          isWorkspaceRoot: true,
          head: { kind: 'detached' },
          materializedBranch: 'feature/in-progress',
        },
      ],
    })

    const targets = await catalog.captureTargets('user-a', WORKSPACE_ID, 'goblin+file:///repo\0runtime-a')

    expect(targets).toContainEqual({
      target: {
        kind: 'git-worktree',
        workspaceId: 'goblin+file:///repo',
        workspaceRuntimeId: 'runtime-a',
        root: 'goblin+file:///repo',
      },
      nativeWorktreePath: '/repo',
    })
  })
})
