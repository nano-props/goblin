import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'
import type { PhysicalWorktreeCapability } from '#/server/worktree-removal/physical-worktree-identity-resolver.ts'

export interface ServerWorktreeRemovalHost {
  removeWorktree(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      worktreePath: string
      signal?: AbortSignal
      remove(
        capability: PhysicalWorktreeCapability,
        lifecycle: RepoWorktreeRemovalLifecycle,
        signal: AbortSignal,
      ): Promise<ExecResult>
    },
  ): Promise<ExecResult>
}
