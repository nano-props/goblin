import { isSafeBranchName, isSafeRefName, isSafeRemoteName } from '#/shared/refnames.ts'

export const GIT_UPSTREAM_FORMAT =
  '%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream:trackshort)'

const RESOLVABLE_TRACK_STATES = new Set(['=', '>', '<', '<>'])

export interface GitUpstreamSource {
  remote: string
  branch: string
}

export interface GitUpstream {
  /** A locally resolvable ref that is safe to pass to ancestry checks. */
  ancestryRef: string | null
  source: GitUpstreamSource
  deleteTarget: GitUpstreamSource | null
}

export function decodeGitUpstream(output: string): GitUpstream | null {
  const fields = output.split('\0')
  if (fields.length !== 4) throw new Error('Git returned an invalid upstream')
  const [configuredRef, remote, remoteRef, trackState] = fields
  if (!configuredRef && !remote && !remoteRef && !trackState) return null
  if (
    !configuredRef ||
    !remote ||
    !remoteRef ||
    !isSafeRefName(configuredRef) ||
    (remote !== '.' && !isSafeRemoteName(remote)) ||
    (trackState !== '' && !RESOLVABLE_TRACK_STATES.has(trackState))
  ) {
    throw new Error('Git returned an invalid upstream')
  }
  const branchPrefix = 'refs/heads/'
  if (!remoteRef.startsWith(branchPrefix)) throw new Error('Git returned an invalid upstream')
  const branch = remoteRef.slice(branchPrefix.length)
  if (!isSafeBranchName(branch)) throw new Error('Git returned an invalid upstream')
  const source = { remote, branch }
  return {
    ancestryRef: trackState === '' ? null : configuredRef,
    source,
    deleteTarget: remote === '.' ? null : source,
  }
}
