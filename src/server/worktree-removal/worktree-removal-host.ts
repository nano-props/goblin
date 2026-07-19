import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { PhysicalWorktreeExecutionCapability } from '#/server/worktree-removal/physical-worktree-capability.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface ServerWorktreeRemovalHost {
  removeWorktree(
    userId: string,
    input: {
      repoRoot: WorkspaceId
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
