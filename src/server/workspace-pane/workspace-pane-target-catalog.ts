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
import { gitHeadBranch, type GitHead } from '#/shared/git-head.ts'

type WorkspacePaneCatalogIdentity =
  | { kind: 'git-branch'; branchName: string }
  | { kind: 'git-worktree'; worktreePath: string; head: GitHead }

interface WorkspacePaneTargetCatalogDependencies {
  hasGitCapability(userId: string, repoRoot: string, repoRuntimeId: string): boolean
  readIdentities(repoRoot: string, options: { repoRuntimeId: string }): Promise<
    readonly WorkspacePaneCatalogIdentity[]
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
        identity.kind === 'git-worktree'
          ? {
              target: {
                kind: 'git-worktree',
                workspaceId,
                workspaceRuntimeId: repoRuntimeId,
                root: workspaceLocatorForNativePath(workspaceId, identity.worktreePath),
              },
              nativeWorktreePath: identity.worktreePath,
              canonicalBranch: gitHeadBranch(identity.head),
            }
          : {
              target: {
                kind: 'git-branch',
                workspaceId,
                workspaceRuntimeId: repoRuntimeId,
                branch: identity.branchName,
              },
              nativeWorktreePath: null,
              canonicalBranch: identity.branchName,
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
