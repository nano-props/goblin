import type { ExecResult } from '#/shared/git-types.ts'

export interface ServerRepoMutationHost {
  deleteBranch(
    userId: string,
    input: {
      repoRoot: string
      repoRuntimeId: string
      branchName: string
      deleteBranch(): Promise<ExecResult>
    },
  ): Promise<ExecResult>
}
