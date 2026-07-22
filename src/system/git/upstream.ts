import { isSafeBranchName, isSafeRefName, isSafeRemoteName } from '#/shared/refnames.ts'

export const GIT_UPSTREAM_FORMAT = '%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)'

export interface GitUpstreamSource {
  remote: string
  branch: string
}

export interface GitUpstream {
  ref: string
  source: GitUpstreamSource
  deleteTarget: GitUpstreamSource | null
}

export function decodeGitUpstream(output: string): GitUpstream | null {
  const fields = output.split('\0')
  if (fields.length !== 3) throw new Error('Git returned an invalid upstream')
  const [ref, remote, remoteRef] = fields
  if (!ref && !remote && !remoteRef) return null
  if (!ref || !remote || !remoteRef || !isSafeRefName(ref) || (remote !== '.' && !isSafeRemoteName(remote))) {
    throw new Error('Git returned an invalid upstream')
  }
  const branchPrefix = 'refs/heads/'
  if (!remoteRef.startsWith(branchPrefix)) throw new Error('Git returned an invalid upstream')
  const branch = remoteRef.slice(branchPrefix.length)
  if (!isSafeBranchName(branch)) throw new Error('Git returned an invalid upstream')
  const source = { remote, branch }
  return { ref, source, deleteTarget: remote === '.' ? null : source }
}
