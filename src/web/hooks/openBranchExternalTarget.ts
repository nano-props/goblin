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

// Opens the URL for an upstream ref like `origin/main`. Tracking refs are
// always `{remote}/{branch}` with the slash splitting the two; splitting on
// the first `/` preserves branch names that contain slashes (e.g.
// `origin/feature/foo`). Returns `{ok:false}` on malformed input — the
// caller can swallow it via `.catch(() => {})` since the click target is
// already gone from view.
export async function openUpstreamBranchExternalTarget(repoId: string, tracking: string): Promise<ExecResult> {
  const slashIndex = tracking.indexOf('/')
  if (slashIndex <= 0 || slashIndex === tracking.length - 1) {
    return { ok: false, message: 'error.invalid-upstream-ref' }
  }
  const remote = tracking.slice(0, slashIndex)
  const branch = tracking.slice(slashIndex + 1)
  return await openRepoUrl(repoId, { type: 'branch', branch, remote })
}
