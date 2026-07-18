import { getWorkspacePaneTargetIdentities } from '#/server/modules/repo-read-paths.ts'
import { workspaceRuntimeHasGitCapability } from '#/server/modules/repo-runtimes.ts'
import type { WorkspacePaneTargetProjection } from '#/server/workspace-pane/workspace-pane-layout-aggregate.ts'
import type { WorkspacePaneTargetProjectionProvider } from '#/server/workspace-pane/workspace-pane-tabs-coordinator.ts'
import {
  canonicalWorkspaceLocator,
  formatWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  type WorkspaceId,
} from '#/shared/workspace-locator.ts'

interface WorkspacePaneTargetCatalogDependencies {
  hasGitCapability(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  readIdentities(repoRoot: string, options: { repoRuntimeId: string }): Promise<
    readonly { branch: string; worktreePath: string | null }[]
  >
}

const defaultDependencies: WorkspacePaneTargetCatalogDependencies = {
  hasGitCapability: workspaceRuntimeHasGitCapability,
  readIdentities: getWorkspacePaneTargetIdentities,
}

export class WorkspacePaneTargetCatalog implements WorkspacePaneTargetProjectionProvider {
  private readonly dependencies: WorkspacePaneTargetCatalogDependencies

  constructor(dependencies: WorkspacePaneTargetCatalogDependencies = defaultDependencies) {
    this.dependencies = dependencies
  }

  async captureTargets(userId: string, repoRoot: string, scope: string): Promise<readonly WorkspacePaneTargetProjection[]> {
    const repoRuntimeId = runtimeIdFromScope(scope)
    const workspaceId = canonicalWorkspaceLocator(repoRoot)
    if (!workspaceId) throw new Error('invalid workspace pane workspace id')
    const workspace = parseCanonicalWorkspaceLocator(workspaceId)
    if (!workspace) throw new Error('invalid workspace pane workspace id')
    const workspaceTarget: WorkspacePaneTargetProjection = {
      target: { kind: 'workspace-root', workspaceId, workspaceRuntimeId: repoRuntimeId },
      nativeWorktreePath: workspace.path,
      canonicalBranch: null,
    }
    if (!this.dependencies.hasGitCapability(userId, repoRoot, repoRuntimeId)) return [workspaceTarget]
    const identities = await this.dependencies.readIdentities(repoRoot, { repoRuntimeId })
    return [
      workspaceTarget,
      ...identities.map((identity): WorkspacePaneTargetProjection =>
        identity.worktreePath
          ? {
              target: {
                kind: 'git-worktree',
                workspaceId,
                workspaceRuntimeId: repoRuntimeId,
                root: workspaceLocatorForNativePath(workspaceId, identity.worktreePath),
              },
              nativeWorktreePath: identity.worktreePath,
              canonicalBranch: identity.branch,
            }
          : {
              target: { kind: 'git-branch', workspaceId, workspaceRuntimeId: repoRuntimeId, branch: identity.branch },
              nativeWorktreePath: null,
              canonicalBranch: identity.branch,
            },
      ),
    ]
  }

  async validateTargets(
    userId: string,
    repoRoot: string,
    scope: string,
    captured: readonly WorkspacePaneTargetProjection[],
  ): Promise<boolean> {
    const repoRuntimeId = runtimeIdFromScope(scope)
    if (!this.dependencies.hasGitCapability(userId, repoRoot, repoRuntimeId)) return captured.length === 1
    const workspaceId = canonicalWorkspaceLocator(repoRoot)
    if (!workspaceId) return false
    const identities = await this.dependencies.readIdentities(repoRoot, { repoRuntimeId })
    return identityTokenFromProjections(captured) === identityTokenFromIdentities(identities)
  }
}

function identityTokenFromIdentities(identities: readonly { branch: string; worktreePath: string | null }[]): string {
  return JSON.stringify(
    identities
      .map((identity) => [identity.branch, identity.worktreePath] as const)
      .sort(([aBranch, aPath], [bBranch, bPath]) =>
        aBranch === bBranch ? (aPath ?? '').localeCompare(bPath ?? '') : aBranch.localeCompare(bBranch),
      ),
  )
}

function identityTokenFromProjections(projections: readonly WorkspacePaneTargetProjection[]): string {
  return JSON.stringify(
    projections
      .filter((projection) => projection.target.kind !== 'workspace-root')
      .map((projection) => [projection.canonicalBranch, projection.nativeWorktreePath] as const)
      .sort(([aBranch, aPath], [bBranch, bPath]) =>
        (aBranch ?? '') === (bBranch ?? '')
          ? (aPath ?? '').localeCompare(bPath ?? '')
          : (aBranch ?? '').localeCompare(bBranch ?? ''),
      ),
  )
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
