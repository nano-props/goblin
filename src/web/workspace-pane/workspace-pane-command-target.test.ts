import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'
import {
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import {
  workspacePaneCommandCoordinates,
  workspacePaneCommandRouteTarget,
  workspacePaneCommandTargetFromQueryCache,
  type WorkspacePaneCommandTarget,
} from '#/web/workspace-pane/workspace-pane-command-target.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspacePaneFilesystemRootPath,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

const filesystemTarget = gitWorktreePaneFilesystemTarget({
  workspaceId: workspaceIdForTest('goblin+file:///tmp/command-target-repo'),
  workspaceRuntimeId: 'repo-runtime-command-target',
  worktreePath: '/tmp/command-target-worktree',
  head: { kind: 'branch', branchName: 'feature/example' },
  capabilities: {
    files: { read: true as const, write: true as const },
    terminal: { available: true as const },
    git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
  },
})

beforeEach(() => {
  resetWorkspacesStore()
})

describe('workspace pane command target', () => {
  test('derives the worktree branch presentation from its single Git head authority', () => {
    const target: WorkspacePaneCommandTarget = {
      workspacePaneRoute: null,
      filesystemTarget,
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBe('feature/example')
    expect(workspacePaneCommandRouteTarget(target)).toEqual({
      kind: 'git-worktree',
      workspaceId: filesystemTarget.workspaceId,
      worktreePath: workspacePaneFilesystemRootPath(filesystemTarget),
    })
  })

  test('derives a detached presentation without a parallel nullable branch field', () => {
    const target: WorkspacePaneCommandTarget = {
      workspacePaneRoute: null,
      filesystemTarget: { ...filesystemTarget, head: { kind: 'detached' } },
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBeNull()
  })

  test('does not admit a contradictory worktree branch field', () => {
    const target: WorkspacePaneCommandTarget = {
      workspacePaneRoute: null,
      filesystemTarget,
      // @ts-expect-error A worktree branch is derived exclusively from filesystemTarget.head.
      branchName: 'feature/conflicting',
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBe('feature/example')
  })

  test('rejects a branch route for a filesystem-only workspace without creating a query', async () => {
    const workspace = seedRepoShellForTest({
      id: 'goblin+file:///tmp/command-target-filesystem-workspace',
      workspaceRuntimeId: 'command-target-filesystem-runtime',
      workspaceProbe: {
        status: 'ready',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })

    const target = workspacePaneCommandTargetFromQueryCache({
      routeContext: {
        kind: 'branch',
        workspaceSlug: 'filesystem-workspace',
        branchName: 'feature/example',
        workspacePaneRoute: { kind: 'static', tab: 'history' },
      },
      workspace,
      queryClient: appQueryClient,
    })

    expect(target).toBeNull()
    expect(appQueryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  test('rejects a materialized branch route even while its accepted snapshot is stale', async () => {
    const workspace = seedRepoWithReadModelForTest({
      worktrees: [createRepoWorktreeSnapshotForTest('feature/example', '/tmp/command-target-branch-worktree')],
      id: 'goblin+file:///tmp/command-target-branch-workspace',
      workspaceRuntimeId: 'command-target-branch-runtime',
      branchSnapshots: [createRepoBranch('feature/example')],
      currentBranchName: 'feature/example',
    })
    const routeContext = {
      kind: 'branch' as const,
      workspaceSlug: 'branch-workspace',
      branchName: 'feature/example',
      workspacePaneRoute: null,
    }

    expect(
      workspacePaneCommandTargetFromQueryCache({
        routeContext,
        workspace,
        queryClient: appQueryClient,
      }),
    ).toBeNull()

    const queryKey = repoSnapshotQueryKey(workspace.id, workspace.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing snapshot query')
    query.setState({ ...query.state, status: 'error', error: new Error('snapshot unavailable') })

    expect(
      workspacePaneCommandTargetFromQueryCache({ routeContext, workspace, queryClient: appQueryClient }),
    ).toBeNull()
    expect(query.getObserversCount()).toBe(0)
  })

  test('admits only a branch that exists and has no materialized worktree', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/command-target-unmaterialized-branch-workspace',
      workspaceRuntimeId: 'command-target-unmaterialized-branch-runtime',
      branchSnapshots: [createRepoBranch('feature/example')],
      currentBranchName: null,
    })
    const branchTarget = workspacePaneCommandTargetFromQueryCache({
      routeContext: {
        kind: 'branch',
        workspaceSlug: 'branch-workspace',
        branchName: 'feature/example',
        workspacePaneRoute: null,
      },
      workspace,
      queryClient: appQueryClient,
    })
    expect(branchTarget).toEqual({
      routeTarget: { kind: 'git-branch', workspaceId: workspace.id, branchName: 'feature/example' },
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      workspacePaneRoute: null,
      filesystemTarget: null,
    })
  })

  test('admits a worktree target from the accepted repository snapshot while a refresh is stale', async () => {
    const worktreePath = '/tmp/command-target-status-worktree'
    const workspace = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/command-target-status-workspace',
      workspaceRuntimeId: 'command-target-status-runtime',
      worktrees: [
        {
          path: worktreePath,
          head: { kind: 'branch', branchName: 'feature/status' },
          headOid: '1111111111111111111111111111111111111111',
          operation: null,
          materializedBranch: 'feature/status',
          isPrimary: false,
          isLocked: false,
        },
      ],
    })
    const routeContext = {
      kind: 'worktree' as const,
      workspaceSlug: 'status-workspace',
      worktreePath,
      workspacePaneRoute: { kind: 'static' as const, tab: 'changes' as const },
    }

    const successfulWorktreeTarget = workspacePaneCommandTargetFromQueryCache({
      routeContext,
      workspace,
      queryClient: appQueryClient,
    })
    expect(successfulWorktreeTarget).toEqual(
      expect.objectContaining({
        workspacePaneRoute: { kind: 'static', tab: 'changes' },
        filesystemTarget: expect.objectContaining({
          kind: 'git-worktree',
          head: { kind: 'branch', branchName: 'feature/status' },
        }),
      }),
    )
    if (!successfulWorktreeTarget?.filesystemTarget) throw new Error('Missing worktree filesystem target')
    expect(workspacePaneFilesystemRootPath(successfulWorktreeTarget.filesystemTarget)).toBe(worktreePath)

    expect(
      workspacePaneCommandTargetFromQueryCache({
        routeContext: { ...routeContext, worktreePath: '/tmp/command-target-missing-worktree' },
        workspace,
        queryClient: appQueryClient,
      }),
    ).toBeNull()

    const queryKey = repoSnapshotQueryKey(workspace.id, workspace.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing repository snapshot query')
    query.setState({ ...query.state, status: 'error', error: new Error('snapshot unavailable') })

    expect(workspacePaneCommandTargetFromQueryCache({ routeContext, workspace, queryClient: appQueryClient })).toEqual(
      successfulWorktreeTarget,
    )
    expect(query.getObserversCount()).toBe(0)
  })
})
