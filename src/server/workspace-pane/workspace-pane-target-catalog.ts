import { getWorkspacePaneTargetMembership } from '#/server/repos/read-paths.ts'
import { workspaceRuntimeHasGitCapability } from '#/server/workspaces/runtime/authority.ts'
import type { WorkspacePaneTargetProjection } from '#/server/workspace-pane/workspace-pane-layout-projection.ts'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { formatWorkspaceLocator, parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTargetMembership } from '#/shared/git-types.ts'

interface WorkspacePaneTargetCatalogDependencies {
  hasGitCapability(userId: string, workspaceId: WorkspaceId, workspaceRuntimeId: string): boolean
  readMembership(
    workspaceId: WorkspaceId,
    options: { workspaceRuntimeId: string; signal?: AbortSignal },
  ): Promise<WorkspacePaneTargetMembership>
}

const defaultDependencies: WorkspacePaneTargetCatalogDependencies = {
  hasGitCapability: workspaceRuntimeHasGitCapability,
  readMembership: getWorkspacePaneTargetMembership,
}

export class WorkspacePaneTargetCatalog implements WorkspacePaneTargetProjectionProvider {
  private readonly dependencies: WorkspacePaneTargetCatalogDependencies

  constructor(dependencies: WorkspacePaneTargetCatalogDependencies = defaultDependencies) {
    this.dependencies = dependencies
  }

  async captureTargets(
    userId: string,
    workspaceId: WorkspaceId,
    scope: string,
    signal?: AbortSignal,
  ): Promise<readonly WorkspacePaneTargetProjection[]> {
    const workspaceRuntimeId = runtimeIdFromScope(scope)
    const workspace = parseCanonicalWorkspaceLocator(workspaceId)
    if (!workspace) throw new Error('invalid workspace pane workspace id')
    const workspaceTarget: WorkspacePaneTargetProjection = {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId },
      nativeWorktreePath: workspace.path,
    }
    if (!this.dependencies.hasGitCapability(userId, workspaceId, workspaceRuntimeId)) return [workspaceTarget]
    const membership = await this.dependencies.readMembership(workspaceId, { workspaceRuntimeId, signal })
    return [
      workspaceTarget,
      ...membership.linkedWorktrees.map((identity): WorkspacePaneTargetProjection => ({
        target: {
          kind: 'git-worktree',
          workspaceId,
          workspaceRuntimeId,
          root: workspaceLocatorForNativePath(workspaceId, identity.worktreePath),
        },
        nativeWorktreePath: identity.worktreePath,
      })),
      ...membership.branches.map((identity): WorkspacePaneTargetProjection => ({
        target: {
          kind: 'git-branch',
          workspaceId,
          workspaceRuntimeId,
          branch: identity.branchName,
        },
        nativeWorktreePath: null,
      })),
    ]
  }
}

function runtimeIdFromScope(scope: string): string {
  const separator = scope.lastIndexOf('\0')
  if (separator < 0 || separator === scope.length - 1) throw new Error('invalid workspace pane runtime scope')
  return scope.slice(separator + 1)
}

function workspaceLocatorForNativePath(workspaceId: WorkspaceId, nativePath: string): WorkspaceId {
  const workspace = parseCanonicalWorkspaceLocator(workspaceId)
  if (!workspace) throw new Error('invalid workspace pane workspace id')
  const root = formatWorkspaceLocator(
    workspace.transport === 'ssh'
      ? { transport: 'ssh', profile: workspace.profile, path: nativePath }
      : { transport: 'file', platform: workspace.platform, path: nativePath },
    workspace.transport === 'file' ? workspace.platform : 'posix',
  )
  if (!root) throw new Error('invalid workspace pane worktree path')
  return root
}
