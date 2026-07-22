import { git, gitLookup } from '#/system/git/git-exec.ts'
import {
  parseRemoteTrackingRefs,
  type RemoteFetchAuthority,
  type RemoteTrackingBranchIdentity,
} from '#/shared/worktree-create.ts'
import { getRemotes } from '#/system/git/remote.ts'

/** List remote-tracking branches for a local repo.
 *
 *  `refs/remotes/` includes the symbolic `origin/HEAD` plus every branch
 *  the remote has; we run the list through `parseRemoteTrackingRefs` so
 *  the local and remote (`system/ssh/git.ts`) sides agree on the shape. */
export async function getRemoteTrackingBranches(cwd: string, signal?: AbortSignal): Promise<RemoteTrackingBranchIdentity[]> {
  const before = await readRemoteTrackingAuthority(cwd, signal)
  const branches = parseRemoteTrackingRefs(before.refs, before.remotes)
  const after = await readRemoteTrackingAuthority(cwd, signal)
  if (before.refs !== after.refs || JSON.stringify(before.remotes) !== JSON.stringify(after.remotes)) {
    throw new Error('Remote tracking authority changed during read')
  }
  return branches
}

async function readRemoteTrackingAuthority(
  cwd: string,
  signal?: AbortSignal,
): Promise<{ refs: string; remotes: RemoteFetchAuthority[] }> {
  const [refs, remotes] = await Promise.all([
    git(cwd, ['for-each-ref', '--format=%(refname)', 'refs/remotes/'], { signal }),
    getRemotes(cwd, signal),
  ])
  const authorities = await Promise.all(
    remotes.map(async (remote): Promise<RemoteFetchAuthority> => ({
      name: remote.name,
      fetchSpecs: splitNonEmptyLines(
        await gitLookup(cwd, ['config', '--get-all', '--', `remote.${remote.name}.fetch`], { signal }),
      ),
    })),
  )
  return { refs, remotes: authorities }
}

function splitNonEmptyLines(output: string): string[] {
  return output ? output.split('\n').filter((line) => line.length > 0) : []
}
