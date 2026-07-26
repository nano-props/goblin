import { describe, expect, test } from 'vitest'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { createBranchSnapshot, createGitWorkspaceProbeForTest } from '#/web/test-utils/bridge.ts'
import { acceptWorkspaceProbeState } from '#/web/stores/workspaces/workspace-guards.ts'
import { emptyWorkspace } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { workspacePaneFilesystemRootPath } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { resolveWorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target-projection.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace/project')
const ROOT_ROUTE_TARGET = { kind: 'workspace-root', workspaceId: WORKSPACE_ID } satisfies WorkspacePaneTabsTarget

function probingWorkspace(workspaceRuntimeId = 'runtime-1') {
  return emptyWorkspace(WORKSPACE_ID, 'project', workspaceRuntimeId)
}

function filesystemWorkspace(workspaceRuntimeId = 'runtime-1') {
  const workspace = probingWorkspace(workspaceRuntimeId)
  acceptWorkspaceProbeState(workspace, {
    status: 'ready',
    name: 'project',
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'unavailable' },
    },
    diagnostics: [],
  })
  return workspace
}

function gitWorkspace(workspaceRuntimeId = 'runtime-1') {
  const workspace = probingWorkspace(workspaceRuntimeId)
  acceptWorkspaceProbeState(workspace, createGitWorkspaceProbeForTest('project'))
  return workspace
}

function unavailableWorkspace(workspaceRuntimeId = 'runtime-1') {
  const workspace = probingWorkspace(workspaceRuntimeId)
  acceptWorkspaceProbeState(workspace, {
    status: 'unavailable',
    reason: 'error.workspace-transport-unavailable',
  })
  return workspace
}

function resolveTarget(overrides: Partial<Parameters<typeof resolveWorkspacePaneCommandTarget>[0]> = {}) {
  return resolveWorkspacePaneCommandTarget({
    routeTarget: ROOT_ROUTE_TARGET,
    workspacePaneRoute: null,
    workspace: filesystemWorkspace(),
    branchReadModel: { status: 'pending', snapshot: null },
    worktreeReadModel: { status: 'pending', worktrees: null },
    ...overrides,
  })
}

describe('resolveWorkspacePaneCommandTarget', () => {
  test('does not project a target while the workspace capability is unresolved', () => {
    const target = resolveTarget({ workspace: probingWorkspace() })

    expect(target).toEqual({ routeAuthority: 'pending', target: null })
  })

  test('keeps an unavailable workspace route pending because the same runtime can recover', () => {
    const target = resolveTarget({ workspace: unavailableWorkspace() })

    expect(target).toEqual({ routeAuthority: 'pending', target: null })
  })

  test('treats a workspace missing from the ready shell projection as stale', () => {
    expect(resolveTarget({ workspace: null })).toEqual({ routeAuthority: 'stale', target: null })
  })

  test('resolves a workspace-root target without waiting for disabled repo queries', () => {
    const target = resolveTarget()

    expect(target.target?.routeTarget).toEqual(ROOT_ROUTE_TARGET)
  })

  test('resolves branch route authority independently from worktree command readiness', () => {
    const routeTarget = { kind: 'git-branch' as const, workspaceId: WORKSPACE_ID, branchName: 'feature' }
    const target = resolveTarget({
      routeTarget,
      workspace: gitWorkspace(),
      branchReadModel: {
        status: 'success',
        snapshot: { branches: [createBranchSnapshot('feature')], current: 'main' },
      },
      worktreeReadModel: { status: 'pending', worktrees: null },
    })

    expect(target).toEqual({
      routeAuthority: 'ready',
      target: { routeTarget, workspacePaneRoute: null, filesystemTarget: null },
    })
  })

  test('atomically resolves a branch command target from matching branch and worktree read models', () => {
    const routeTarget = { kind: 'git-branch' as const, workspaceId: WORKSPACE_ID, branchName: 'feature' }
    const worktreePath = '/workspace/project-feature'
    const snapshot: RepoSnapshot = {
      branches: [createBranchSnapshot('feature', { worktree: { path: worktreePath } })],
      current: 'main',
    }
    const target = resolveTarget({
      routeTarget,
      workspace: gitWorkspace(),
      branchReadModel: { status: 'success', snapshot },
      worktreeReadModel: {
        status: 'success',
        worktrees: [{ path: worktreePath, branch: 'feature', isMain: false, entries: [] }],
      },
    })

    const filesystemTarget = target.target?.filesystemTarget
    if (!filesystemTarget) throw new Error('missing projected branch filesystem target')
    expect(workspacePaneFilesystemRootPath(filesystemTarget)).toBe(worktreePath)
  })

  test('resolves a direct worktree target from the worktree read model alone', () => {
    const worktreePath = '/workspace/project-worktree'
    const target = resolveTarget({
      routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath },
      workspace: gitWorkspace(),
      branchReadModel: {
        status: 'success',
        snapshot: {
          branches: [createBranchSnapshot('feature', { worktree: { path: worktreePath } })],
          current: 'main',
        },
      },
      worktreeReadModel: {
        status: 'success',
        worktrees: [{ path: worktreePath, branch: 'feature', isMain: false, entries: [] }],
      },
    })

    const filesystemTarget = target.target?.filesystemTarget
    if (!filesystemTarget) throw new Error('missing projected worktree filesystem target')
    expect(workspacePaneFilesystemRootPath(filesystemTarget)).toBe(worktreePath)
  })

  test('waits for branch authority before resolving a branch-headed worktree route', () => {
    const worktreePath = '/workspace/project-worktree'
    const target = resolveTarget({
      routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath },
      workspace: gitWorkspace(),
      branchReadModel: { status: 'pending', snapshot: null },
      worktreeReadModel: {
        status: 'success',
        worktrees: [{ path: worktreePath, branch: 'feature', isMain: false, entries: [] }],
      },
    })

    expect(target).toEqual({ routeAuthority: 'pending', target: null })
  })

  test('keeps a branch route pending while its failed read model has no authoritative answer', () => {
    const target = resolveTarget({
      routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature' },
      workspace: gitWorkspace(),
      branchReadModel: { status: 'error', snapshot: null },
    })

    expect(target).toEqual({ routeAuthority: 'pending', target: null })
  })

  test('keeps a worktree route pending while its failed read model can still recover', () => {
    const target = resolveTarget({
      routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace/project-worktree' },
      workspace: gitWorkspace(),
      worktreeReadModel: { status: 'error', worktrees: null },
    })

    expect(target).toEqual({ routeAuthority: 'pending', target: null })
  })

  test('marks a branch missing from a complete read model as stale', () => {
    const routeTarget = { kind: 'git-branch' as const, workspaceId: WORKSPACE_ID, branchName: 'feature' }
    const target = resolveTarget({
      routeTarget,
      workspace: gitWorkspace(),
      branchReadModel: { status: 'success', snapshot: { branches: [], current: 'main' } },
      worktreeReadModel: { status: 'success', worktrees: [] },
    })

    expect(target).toEqual({ routeAuthority: 'stale', target: null })
  })

  test('rejects a route target owned by a different workspace projection', () => {
    const differentWorkspaceId = workspaceIdForTest('goblin+file:///workspace/different')
    const target = resolveTarget({ workspace: emptyWorkspace(differentWorkspaceId, 'different', 'runtime-1') })

    expect(target).toEqual({ routeAuthority: 'stale', target: null })
  })
})
