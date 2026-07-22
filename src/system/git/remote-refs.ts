import { git } from '#/system/git/git-exec.ts'
import { parseRemoteTrackingRefs } from '#/shared/worktree-create.ts'

/** List remote-tracking branches for a local repo.
 *
 *  `refs/remotes/` includes the symbolic `origin/HEAD` plus every branch
 *  the remote has; we run the list through `parseRemoteTrackingRefs` so
 *  the local and remote (`system/ssh/git.ts`) sides agree on the shape. */
export async function getRemoteTrackingBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  const output = await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'], { signal })
  return parseRemoteTrackingRefs(output)
}
