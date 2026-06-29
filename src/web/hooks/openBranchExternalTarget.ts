import { openRepoUrl } from '#/web/repo-client.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'

export async function openBranchExternalTarget(
  repoId: string,
  branch: Pick<RepoBranchState, 'name' | 'pullRequest'>,
): Promise<ExecResult> {
  if (branch.pullRequest?.url) return await openExternalUrl(branch.pullRequest.url)
  return await openRepoUrl(repoId, { type: 'branch', branch: branch.name })
}
