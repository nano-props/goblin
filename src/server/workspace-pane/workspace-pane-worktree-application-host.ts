import type { ExecResult } from '#/shared/git-types.ts'

export interface ServerWorkspacePaneWorktreeApplicationHost {
  removeWorktree(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      worktreePath: string
      remove(beforeRemove: () => Promise<ExecResult>): Promise<ExecResult>
    },
  ): Promise<ExecResult>
}
