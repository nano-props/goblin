import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface ServerRepoMutationHost {
  deleteBranch(
    userId: string,
    input: {
      repoRoot: WorkspaceId
      workspaceRuntimeId: string
      branchName: string
      deleteBranch(): Promise<ExecResult>
    },
  ): Promise<ExecResult>
}
