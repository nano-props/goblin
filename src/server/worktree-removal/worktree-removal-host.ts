import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'

export interface ServerWorktreeRemovalHost {
  removeWorktree(
    userId: string,
    input: {
      repoRoot: string
      workspaceRuntimeId: string
      worktreePath: string
      branchName: string
      deleteBranch: boolean
      signal?: AbortSignal
      remove(
        capability: PhysicalWorktreeExecutionCapability,
        lifecycle: RepoWorktreeRemovalLifecycle,
        signal: AbortSignal,
      ): Promise<ExecResult>
    },
  ): Promise<ExecResult>
}
