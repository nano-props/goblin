import { beforeEach, describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import {
  workspacePaneCommandCoordinates,
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
      routeTarget: {
        kind: 'git-worktree',
        workspaceId: filesystemTarget.workspaceId,
        worktreePath: workspacePaneFilesystemRootPath(filesystemTarget),
      },
      workspacePaneRoute: null,
      filesystemTarget,
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBe('feature/example')
  })

  test('derives a detached presentation without a parallel nullable branch field', () => {
    const target: WorkspacePaneCommandTarget = {
      routeTarget: {
        kind: 'git-worktree',
        workspaceId: filesystemTarget.workspaceId,
        worktreePath: workspacePaneFilesystemRootPath(filesystemTarget),
      },
      workspacePaneRoute: null,
      filesystemTarget: { ...filesystemTarget, head: { kind: 'detached' } },
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBeNull()
  })

  test('does not admit a contradictory worktree branch field', () => {
    const target: WorkspacePaneCommandTarget = {
      routeTarget: {
        kind: 'git-worktree',
        workspaceId: filesystemTarget.workspaceId,
        worktreePath: workspacePaneFilesystemRootPath(filesystemTarget),
      },
      workspacePaneRoute: null,
      filesystemTarget,
      // @ts-expect-error A worktree branch is derived exclusively from filesystemTarget.head.
      branchName: 'feature/conflicting',
    }

    expect(workspacePaneCommandCoordinates(target).branchName).toBe('feature/example')
  })

  test('retains the branch route target without creating a query for a filesystem-only workspace', async () => {
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

    expect(target).toEqual({
      routeTarget: { kind: 'git-branch', workspaceId: workspace.id, branchName: 'feature/example' },
      workspacePaneRoute: { kind: 'static', tab: 'history' },
      filesystemTarget: null,
    })
    expect(appQueryClient.getQueryCache().getAll()).toHaveLength(0)
  })

  test('projects a branch worktree only from a successful matching snapshot', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/command-target-branch-workspace',
      workspaceRuntimeId: 'command-target-branch-runtime',
      branchSnapshots: [
        createRepoBranch('feature/example', {
          worktree: { path: '/tmp/command-target-branch-worktree', isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/example',
    })
    const routeContext = {
      kind: 'branch' as const,
      workspaceSlug: 'branch-workspace',
      branchName: 'feature/example',
      workspacePaneRoute: null,
    }

    const successfulBranchTarget = workspacePaneCommandTargetFromQueryCache({
      routeContext,
      workspace,
      queryClient: appQueryClient,
    })
    expect(successfulBranchTarget?.filesystemTarget).toEqual(
      expect.objectContaining({
        kind: 'git-worktree',
        head: { kind: 'branch', branchName: 'feature/example' },
      }),
    )
    if (!successfulBranchTarget?.filesystemTarget) throw new Error('Missing branch filesystem target')
    expect(workspacePaneFilesystemRootPath(successfulBranchTarget.filesystemTarget)).toBe(
      '/tmp/command-target-branch-worktree',
    )

    const queryKey = repoSnapshotQueryKey(workspace.id, workspace.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing snapshot query')
    query.setState({ ...query.state, status: 'error', error: new Error('snapshot unavailable') })

    expect(workspacePaneCommandTargetFromQueryCache({ routeContext, workspace, queryClient: appQueryClient })).toEqual({
      routeTarget: { kind: 'git-branch', workspaceId: workspace.id, branchName: 'feature/example' },
      workspacePaneRoute: null,
      filesystemTarget: null,
    })
    expect(query.getObserversCount()).toBe(0)
  })

  test('admits a worktree target only from a successful matching status snapshot', async () => {
    const worktreePath = '/tmp/command-target-status-worktree'
    const workspace = seedRepoWithReadModelForTest({
      id: 'goblin+file:///tmp/command-target-status-workspace',
      workspaceRuntimeId: 'command-target-status-runtime',
      status: [{ path: worktreePath, branch: 'feature/status', isMain: false, entries: [] }],
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
        routeTarget: { kind: 'git-worktree', workspaceId: workspace.id, worktreePath },
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

    const queryKey = repoWorktreeStatusQueryKey(workspace.id, workspace.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing worktree status query')
    query.setState({ ...query.state, status: 'error', error: new Error('status unavailable') })

    expect(
      workspacePaneCommandTargetFromQueryCache({ routeContext, workspace, queryClient: appQueryClient }),
    ).toBeNull()
    expect(query.getObserversCount()).toBe(0)
  })
})
