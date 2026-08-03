import { openRepoUrl } from '#/web/repo-client.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { ExecResult } from '#/shared/git-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export async function openBranchExternalTarget(
  repoId: WorkspaceId,
  workspaceRuntimeId: string,
  branch: { name: string; pullRequest?: PullRequestInfo },
): Promise<ExecResult> {
  if (branch.pullRequest?.url) return await openExternalUrl(branch.pullRequest.url)
  return await openRepoUrl(repoId, workspaceRuntimeId, { type: 'branch', branch: branch.name })
}

export async function openUpstreamBranchExternalTarget(
  repoId: WorkspaceId,
  workspaceRuntimeId: string,
  tracking: string,
): Promise<ExecResult> {
  const gitRemote = getRepoSnapshotQueryData(repoId, workspaceRuntimeId)?.remote
  if (!gitRemote) return { ok: false, message: 'error.invalid-upstream-ref' }
  const remoteName = resolveTrackingRemoteName(
    tracking,
    gitRemote.remotes.map((remote) => remote.name),
  )
  if (!remoteName) {
    return { ok: false, message: 'error.invalid-upstream-ref' }
  }
  const branch = tracking.slice(remoteName.length + 1)
  if (!branch) return { ok: false, message: 'error.invalid-upstream-ref' }
  return await openRepoUrl(repoId, workspaceRuntimeId, { type: 'branch', branch, remote: remoteName })
}

function resolveTrackingRemoteName(tracking: string, remotes: readonly string[]): string | null {
  const matchedRemote = [...remotes]
    .filter((remote) => tracking.startsWith(`${remote}/`))
    .sort((a, b) => b.length - a.length)[0]
  if (matchedRemote) return matchedRemote

  const slashIndex = tracking.indexOf('/')
  if (slashIndex <= 0 || slashIndex === tracking.length - 1) return null
  return tracking.slice(0, slashIndex)
}
