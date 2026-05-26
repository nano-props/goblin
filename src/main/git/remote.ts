import { git, gitResultWithOptions, NETWORK_TIMEOUT_MS } from '#/main/git/helper.ts'
import type { ExecResult, GitRemoteInfo, RepoRemoteInfo } from '#/shared/git-types.ts'
import { getCurrentBranch } from '#/main/git/branches.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'

export interface UpstreamParts {
  remote: string
  branch: string
}

function remoteUrlToHttps(url: string): string | null {
  const sshUrl = url.match(/^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`

  const httpsUrl = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (httpsUrl) return `https://${httpsUrl[1]}/${httpsUrl[2]}`

  const scpUrl = url.match(/^(?:[^@]+@)?([^:/\s]+):([^/].*?)(?:\.git)?\/?$/)
  if (scpUrl) return `https://${scpUrl[1]}/${scpUrl[2]}`

  return null
}

export async function getGitHubUrl(
  cwd: string,
  options?: { branch?: string; signal?: AbortSignal },
): Promise<string | null> {
  try {
    const [remotes, upstream] = await Promise.all([
      getRemotes(cwd, options?.signal),
      options?.branch ? getUpstreamParts(cwd, options.branch, options.signal) : Promise.resolve(null),
    ])
    const remote = pickGitHubRemote(remotes, upstream)
    return remote ? remoteUrlToHttps(remote.url) : null
  } catch {
    return null
  }
}

export async function getPullRequestUrl(cwd: string, branch: string): Promise<string | null> {
  const repoUrl = await getGitHubUrl(cwd, { branch })
  if (!repoUrl) return null
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  // `/pull/new/{branch}` redirects to the existing open PR if one is
  // associated with the branch; otherwise it lands on GitHub's "create
  // pull request" page pre-populated with that branch as the head. This
  // single URL covers both intents the user has when clicking "Open in
  // GitHub" from a branch row — see an existing PR, or start one.
  return `${repoUrl}/pull/new/${encoded}`
}

async function hasRemote(cwd: string, remote: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const url = await git(cwd, ['remote', 'get-url', '--', remote], { signal })
    return url.length > 0
  } catch {
    return false
  }
}

function parseRemoteVerbose(output: string): GitRemoteInfo[] {
  const remotes = new Map<string, GitRemoteInfo>()
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/)
    if (!match || match[3] !== 'fetch') continue
    const name = match[1]!
    if (!remotes.has(name)) remotes.set(name, { name, url: match[2]! })
  }
  return Array.from(remotes.values())
}

export async function getRemotes(cwd: string, signal?: AbortSignal): Promise<GitRemoteInfo[]> {
  return parseRemoteVerbose(await git(cwd, ['remote', '-v'], { signal }))
}

export function pickPreferredRemote<T extends { name: string }>(
  remotes: T[],
  upstream?: UpstreamParts | null,
): T | null {
  if (upstream?.remote && upstream.remote !== '.') {
    const upstreamRemote = remotes.find((remote) => remote.name === upstream.remote)
    if (upstreamRemote) return upstreamRemote
  }
  return remotes.find((remote) => remote.name === 'origin') ?? remotes[0] ?? null
}

function pickGitHubRemote(remotes: GitRemoteInfo[], upstream?: UpstreamParts | null): GitRemoteInfo | null {
  return pickPreferredRemote(
    remotes.filter((remote) => remoteUrlToHttps(remote.url)),
    upstream,
  )
}

export async function getRemoteInfo(cwd: string, signal?: AbortSignal): Promise<RepoRemoteInfo> {
  const remotes = await getRemotes(cwd, signal)
  return {
    remotes,
    hasRemotes: remotes.length > 0,
    hasGitHubRemote: pickGitHubRemote(remotes) !== null,
  }
}

export async function getUpstreamParts(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<UpstreamParts | null> {
  if (!isSafeBranchName(branch)) return null
  try {
    const [remote, mergeRef] = await Promise.all([
      git(cwd, ['config', '--get', `branch.${branch}.remote`], { signal }),
      git(cwd, ['config', '--get', `branch.${branch}.merge`], { signal }),
    ])
    const remoteBranch = mergeRef.startsWith('refs/heads/') ? mergeRef.slice('refs/heads/'.length) : ''
    if (!remote || !remoteBranch || !isSafeBranchName(remoteBranch)) return null
    return { remote, branch: remoteBranch }
  } catch {
    return null
  }
}

function resolveFallbackPushRemote(remotes: GitRemoteInfo[]): string | null {
  if (remotes.length === 0) return null
  if (remotes.some((remote) => remote.name === 'origin')) return 'origin'
  return remotes.length === 1 ? remotes[0]!.name : null
}

async function resolvePushTarget(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<{ remote: string; branch: string; setUpstream: boolean } | ExecResult> {
  const [remotes, upstream] = await Promise.all([getRemotes(cwd, signal), getUpstreamParts(cwd, branch, signal)])
  const remoteNames = new Set(remotes.map((remote) => remote.name))
  const upstreamRemoteExists = !!upstream && upstream.remote !== '.' && remoteNames.has(upstream.remote)
  if (upstreamRemoteExists) {
    return { remote: upstream.remote, branch: upstream.branch, setUpstream: false }
  }
  const remote = resolveFallbackPushRemote(remotes)
  if (!remote) {
    return { ok: false, message: remotes.length === 0 ? 'error.push-no-remote' : 'error.push-ambiguous-remote' }
  }
  return { remote, branch, setUpstream: true }
}

export async function fetchAll(cwd: string, signal?: AbortSignal): Promise<ExecResult> {
  let remotes: GitRemoteInfo[] | null = null
  try {
    remotes = await getRemotes(cwd, signal)
  } catch {
    remotes = null
  }
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (remotes?.length === 0) return { ok: true, message: '' }
  return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'fetch', '--all', '--prune')
}

export async function pullBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (worktreePath) {
    return gitResultWithOptions(worktreePath, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'pull', '--ff-only')
  }
  const current = await getCurrentBranch(cwd, { signal })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (branch === current) {
    return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'pull', '--ff-only')
  }
  const target = await getUpstreamParts(cwd, branch, signal)
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!target) return { ok: false, message: 'error.invalid-arguments' }
  const remoteExists = target.remote === '.' || (await hasRemote(cwd, target.remote, signal))
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!remoteExists) {
    return { ok: false, message: 'error.pull-no-remote' }
  }
  return gitResultWithOptions(
    cwd,
    { timeoutMs: NETWORK_TIMEOUT_MS, signal },
    'fetch',
    '--',
    target.remote,
    `${target.branch}:${branch}`,
  )
}

export async function pushBranch(cwd: string, branch: string, signal?: AbortSignal): Promise<ExecResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  const target = await resolvePushTarget(cwd, branch, signal)
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if ('ok' in target) return target
  const args = target.setUpstream
    ? ['push', '-u', '--', target.remote, `${branch}:${target.branch}`]
    : ['push', '--', target.remote, `${branch}:${target.branch}`]
  return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, ...args)
}
