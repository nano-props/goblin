import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

interface WorkspacePaneTerminalExecutionTargetResolverDependencies {
  readRepo: (repoId: string) => RepoState | undefined
  readGitWorktree: (repo: RepoState, branchName: string) => { branchName: string; worktreePath: string } | null
}

const defaultDependencies: WorkspacePaneTerminalExecutionTargetResolverDependencies = {
  readRepo: (repoId) => useReposStore.getState().repos[repoId],
  readGitWorktree: (repo, branchName) => {
    const branch = readRepoBranchSnapshotQueryProjection(repo)?.branches.find(
      (candidate) => candidate.name === branchName,
    )
    return branch?.worktree?.path ? { branchName: branch.name, worktreePath: branch.worktree.path } : null
  },
}
const defaultResolver = createWorkspacePaneTerminalExecutionTargetResolver(defaultDependencies)

/**
 * Resolves terminal execution from runtime membership and the authoritative
 * branch/worktree read model. Pane-tab hydration is presentation state and
 * deliberately does not participate in terminal admission.
 */
export function resolveWorkspacePaneTerminalExecutionTarget(
  repoId: string,
  branchName: string | null,
): TerminalSessionBase | null {
  return defaultResolver(repoId, branchName)
}

export function createWorkspacePaneTerminalExecutionTargetResolver(
  dependencies: WorkspacePaneTerminalExecutionTargetResolverDependencies,
): (repoId: string, branchName: string | null) => TerminalSessionBase | null {
  return (repoId, branchName) => {
    const repo = dependencies.readRepo(repoId)
    if (!repo) return null
    if (branchName === null) {
      const target = runtimeWorkspacePaneTarget(
        { kind: 'workspace-root', repoRoot: repoId, branchName: null, worktreePath: null },
        repo.repoRuntimeId,
      )
      return target?.kind === 'workspace-root' ? { target, presentation: { kind: 'workspace-root' } } : null
    }
    const worktree = dependencies.readGitWorktree(repo, branchName)
    if (!worktree) return null
    const target = runtimeWorkspacePaneTarget(
      { repoRoot: repoId, branchName: worktree.branchName, worktreePath: worktree.worktreePath },
      repo.repoRuntimeId,
    )
    return target?.kind === 'git-worktree'
      ? { target, presentation: { kind: 'git-worktree', branchName: worktree.branchName } }
      : null
  }
}
