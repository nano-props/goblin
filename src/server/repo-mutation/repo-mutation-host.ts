import type { RepoMutationResult } from '#/server/modules/repo-mutation-impact.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface ServerRepoMutationHost {
  deleteBranch(
    userId: string,
    input: {
      repoRoot: WorkspaceId
      workspaceRuntimeId: string
      branchName: string
      deleteBranch(): Promise<RepoMutationResult>
    },
  ): Promise<RepoMutationResult>
}
