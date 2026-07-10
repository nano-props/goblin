import type { ExecResult } from '#/shared/git-types.ts'
import type { RepoWorktreeRemovalLifecycle } from '#/server/modules/repo-worktree-removal-lifecycle.ts'

export interface ServerWorktreeRemovalHost {
  removeWorktree(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      worktreePath: string
      remove(lifecycle: RepoWorktreeRemovalLifecycle): Promise<ExecResult>
    },
  ): Promise<ExecResult>
}
