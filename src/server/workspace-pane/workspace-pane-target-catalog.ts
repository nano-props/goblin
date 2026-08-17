import { getWorkspacePaneTargetIdentities } from '#/server/repos/read-paths.ts'
import {
  WorkspaceRuntimeStaleError,
  workspaceRuntimeGitCapabilityState,
} from '#/server/workspaces/runtime/authority.ts'
import type { WorkspaceRuntimeGitCapabilityState } from '#/server/workspaces/runtime/authority.ts'
import type { WorkspacePaneTargetProjection } from '#/server/workspace-pane/workspace-pane-layout-projection.ts'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import { formatWorkspaceLocator, parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTargetIdentity } from '#/shared/git-types.ts'

interface WorkspacePaneTargetCatalogDependencies {
  gitCapabilityState(
    userId: string,
    workspaceId: WorkspaceId,
    workspaceRuntimeId: string,
  ): WorkspaceRuntimeGitCapabilityState
  readIdentities(
    workspaceId: WorkspaceId,
    options: { workspaceRuntimeId: string },
  ): Promise<readonly WorkspacePaneTargetIdentity[]>
}

const defaultDependencies: WorkspacePaneTargetCatalogDependencies = {
  gitCapabilityState: workspaceRuntimeGitCapabilityState,
  readIdentities: getWorkspacePaneTargetIdentities,
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
    purpose: 'projection' | 'git-capability-promotion' = 'projection',
  ): Promise<readonly WorkspacePaneTargetProjection[]> {
    const workspaceRuntimeId = runtimeIdFromScope(scope)
    const workspace = parseCanonicalWorkspaceLocator(workspaceId)
    if (!workspace) throw new Error('invalid workspace pane workspace id')
    const workspaceTarget: WorkspacePaneTargetProjection = {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId },
      nativeWorktreePath: workspace.path,
    }
    const gitCapabilityState = this.dependencies.gitCapabilityState(userId, workspaceId, workspaceRuntimeId)
    if (gitCapabilityState === 'transitioning' && purpose !== 'git-capability-promotion') {
      throw new WorkspaceRuntimeStaleError()
    }
    if (gitCapabilityState === 'unavailable' && purpose !== 'git-capability-promotion') return [workspaceTarget]
    const identities = await this.dependencies.readIdentities(workspaceId, { workspaceRuntimeId })
    const workspaceRootWorktrees = identities.filter(
      (identity) => identity.kind === 'git-worktree' && identity.isWorkspaceRoot,
    )
    if (workspaceRootWorktrees.length > 1) throw new Error('error.workspace-tabs-target-invalid')
    const rootIsWorktree = workspaceRootWorktrees.length === 1
    return [
      ...(rootIsWorktree ? [] : [workspaceTarget]),
      ...identities.map((identity): WorkspacePaneTargetProjection =>
        identity.kind === 'git-worktree'
          ? {
              target: {
                kind: 'git-worktree',
                workspaceId,
                workspaceRuntimeId,
                root: identity.isWorkspaceRoot
                  ? workspaceId
                  : workspaceLocatorForNativePath(workspaceId, identity.worktreePath),
              },
              nativeWorktreePath: identity.worktreePath,
            }
          : {
              target: {
                kind: 'git-branch',
                workspaceId,
                workspaceRuntimeId,
                branch: identity.branchName,
              },
              nativeWorktreePath: null,
            },
      ),
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
