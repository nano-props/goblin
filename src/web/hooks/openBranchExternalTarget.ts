import { openRepoUrl } from '#/web/repo-client.ts'
import { openExternalUrl } from '#/web/app-shell-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoBranchState } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'

export async function openBranchExternalTarget(
  repoId: string,
  branch: Pick<RepoBranchState, 'name' | 'pullRequest'>,
): Promise<ExecResult> {
  if (branch.pullRequest?.url) return await openExternalUrl(branch.pullRequest.url)
  return await openRepoUrl(repoId, { type: 'branch', branch: branch.name })
}

export async function openUpstreamBranchExternalTarget(repoId: string, tracking: string): Promise<ExecResult> {
  const repo = useReposStore.getState().repos[repoId]
  const remoteName = resolveTrackingRemoteName(
    tracking,
    repo?.remote.remotes ?? Object.keys(repo?.remote.remoteProviders ?? {}),
  )
  if (!remoteName) {
    return { ok: false, message: 'error.invalid-upstream-ref' }
  }
  const branch = tracking.slice(remoteName.length + 1)
  if (!branch) return { ok: false, message: 'error.invalid-upstream-ref' }
  return await openRepoUrl(repoId, { type: 'branch', branch, remote: remoteName })
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
