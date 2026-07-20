import { git, gitResultWithOptions, NETWORK_TIMEOUT_MS } from '#/system/git/git-exec.ts'
import {
  GIT_HASH_RE,
  type BrowserRemoteProvider,
  type ExecResult,
  type GitRemoteInfo,
  type RepoRemoteInfo,
  type RepoUrlTarget,
} from '#/shared/git-types.ts'
import { getCurrentBranch } from '#/system/git/branches.ts'
import { isGitHubHost, isGitLabHost, parseGitRemoteUrl, remoteUrlToHttps } from '#/system/git/remote-url.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'

export interface UpstreamParts {
  remote: string
  branch: string
}

export interface PushTarget {
  remote: string
  branch: string
  setUpstream: boolean
}

export interface BrowserRemote {
  url: string
  provider: BrowserRemoteProvider
}

export interface GitPullResult extends ExecResult {
  affectedWorktreePaths?: readonly string[]
}

export async function getBrowserRepoUrl(
  cwd: string,
  target: RepoUrlTarget,
  options?: { signal?: AbortSignal },
): Promise<string | null> {
  if (target.type === 'branch' && !isSafeBranchName(target.branch)) return null
  if (target.type === 'commit' && !GIT_HASH_RE.test(target.hash)) return null
  // When the caller pins a specific remote (e.g. clicking an upstream chip
  // like `origin/main`), resolve that exact remote instead of guessing from
  // the local branch's tracking config.
  if (target.type === 'branch' && target.remote) {
    const remote = await resolveExplicitRemote(cwd, target.remote, options?.signal)
    return repoUrlForBrowserRemote(remote, target)
  }
  const branch = target.type === 'branch' ? target.branch : undefined
  const remote = await getBrowserRemote(cwd, { branch, signal: options?.signal })
  return repoUrlForBrowserRemote(remote, target)
}

// Resolves a single named remote (e.g. "origin") into a `BrowserRemote` so
// callers that already know which remote they want can bypass the
// preferred-remote guessing in `getBrowserRemote`.
async function resolveExplicitRemote(
  cwd: string,
  remoteName: string,
  signal?: AbortSignal,
): Promise<BrowserRemote | null> {
  try {
    const remotes = await getRemotes(cwd, signal)
    const target = remotes.find((remote) => remote.name === remoteName)
    if (!target) return null
    return browserRemote(target)
  } catch {
    return null
  }
}

async function hasRemote(cwd: string, remote: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const url = await git(cwd, ['remote', 'get-url', '--', remote], { signal })
    return url.length > 0
  } catch {
    return false
  }
}

export function parseRemoteVerbose(output: string): GitRemoteInfo[] {
  const remotes = new Map<string, { name: string; fetchUrl?: string; pushUrl?: string }>()
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(.+?)\s+\((fetch|push)\)$/)
    if (!match) continue
    const name = match[1]!
    const remote = remotes.get(name) ?? { name }
    if (match[3] === 'fetch') remote.fetchUrl = match[2]!
    else remote.pushUrl = match[2]!
    remotes.set(name, remote)
  }
  return Array.from(remotes.values()).flatMap((remote) => {
    const fetchUrl = remote.fetchUrl ?? remote.pushUrl
    const pushUrl = remote.pushUrl ?? remote.fetchUrl
    return fetchUrl && pushUrl ? [{ name: remote.name, fetchUrl, pushUrl }] : []
  })
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
    remotes.filter((remote) => {
      const parsed = parseGitRemoteUrl(remote.fetchUrl)
      return !!parsed && isGitHubHost(parsed.host) && parsed.path.split('/').filter(Boolean).length === 2
    }),
    upstream,
  )
}

function browserRemoteProvider(host: string): BrowserRemoteProvider {
  if (isGitHubHost(host)) return 'github'
  if (isGitLabHost(host)) return 'gitlab'
  return 'external'
}

export function browserRemote(remote: GitRemoteInfo): BrowserRemote | null {
  const parsed = parseGitRemoteUrl(remote.fetchUrl)
  const url = remoteUrlToHttps(remote.fetchUrl)
  if (!parsed || !url) return null
  return { url, provider: browserRemoteProvider(parsed.host) }
}

export function pickBrowserRemote(remotes: GitRemoteInfo[], upstream?: UpstreamParts | null): BrowserRemote | null {
  return pickPreferredRemote(
    remotes
      .map((remote) => {
        const browser = browserRemote(remote)
        return browser ? { name: remote.name, ...browser } : null
      })
      .filter((remote): remote is { name: string } & BrowserRemote => remote !== null),
    upstream,
  )
}

async function getBrowserRemote(
  cwd: string,
  options?: { branch?: string; signal?: AbortSignal },
): Promise<BrowserRemote | null> {
  try {
    const [remotes, upstream] = await Promise.all([
      getRemotes(cwd, options?.signal),
      options?.branch ? getUpstreamParts(cwd, options.branch, options.signal) : Promise.resolve(null),
    ])
    return pickBrowserRemote(remotes, upstream)
  } catch {
    return null
  }
}

export async function getRemoteInfo(cwd: string, signal?: AbortSignal): Promise<RepoRemoteInfo> {
  const remotes = await getRemotes(cwd, signal)
  return repoRemoteInfoForRemotes(remotes)
}

export function repoRemoteInfoForRemotes(remotes: GitRemoteInfo[]): RepoRemoteInfo {
  const remoteProviders = Object.fromEntries(
    remotes.flatMap((remote) => {
      const browser = browserRemote(remote)
      return browser ? [[remote.name, browser.provider] as const] : []
    }),
  )
  const browser = pickBrowserRemote(remotes)
  return {
    remotes,
    hasRemotes: remotes.length > 0,
    hasBrowserRemote: browser !== null,
    browserRemoteProvider: browser?.provider,
    remoteProviders,
    hasGitHubRemote: pickGitHubRemote(remotes) !== null,
  }
}

export function resolveFetchRemoteForRemotes(remotes: GitRemoteInfo[], upstream?: UpstreamParts | null): string | null {
  return pickPreferredRemote(remotes, upstream)?.name ?? null
}

// Constructs web URLs for supported browser remotes. Returns null for
// unsupported targets/providers so callers don't emit guessed URLs that 404.
export function repoUrlForBrowserRemote(remote: BrowserRemote | null, target: RepoUrlTarget): string | null {
  if (!remote) return null
  if (target.type === 'root') return remote.url
  if (target.type === 'branch') return branchUrlForBrowserRemote(remote, target.branch)
  return commitUrlForBrowserRemote(remote, target.hash)
}

export function branchUrlForBrowserRemote(remote: BrowserRemote | null, branch: string): string | null {
  if (!remote) return null
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  if (remote.provider === 'github') return `${remote.url}/tree/${encoded}`
  if (remote.provider === 'gitlab') return `${remote.url}/-/tree/${encoded}`
  return null
}

export function commitUrlForBrowserRemote(remote: BrowserRemote | null, hash: string): string | null {
  if (!remote || !GIT_HASH_RE.test(hash)) return null
  if (remote.provider === 'github') return `${remote.url}/commit/${hash}`
  if (remote.provider === 'gitlab') return `${remote.url}/-/commit/${hash}`
  return null
}

export function getRepoUrlForRemotes(
  remotes: GitRemoteInfo[],
  target: RepoUrlTarget,
  upstream?: UpstreamParts | null,
): string | null {
  return repoUrlForBrowserRemote(pickBrowserRemote(remotes, upstream), target)
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

export function resolvePushTargetForRemotes(
  remotes: GitRemoteInfo[],
  upstream: UpstreamParts | null | undefined,
  branch: string,
): PushTarget | ExecResult {
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

async function resolvePushTarget(cwd: string, branch: string, signal?: AbortSignal): Promise<PushTarget | ExecResult> {
  const [remotes, upstream] = await Promise.all([getRemotes(cwd, signal), getUpstreamParts(cwd, branch, signal)])
  return resolvePushTargetForRemotes(remotes, upstream, branch)
}

export async function fetchAll(cwd: string, signal?: AbortSignal): Promise<ExecResult> {
  let remotes: GitRemoteInfo[]
  let upstream: UpstreamParts | null
  try {
    const currentBranch = await getCurrentBranch(cwd, { signal })
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    ;[remotes, upstream] = await Promise.all([
      getRemotes(cwd, signal),
      currentBranch ? getUpstreamParts(cwd, currentBranch, signal) : Promise.resolve(null),
    ])
  } catch (err) {
    if (signal?.aborted) return { ok: false, message: 'cancelled' }
    return { ok: false, message: err instanceof Error ? err.message : 'error.failed-read-repo' }
  }
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (remotes.length === 0) return { ok: true, message: '' }
  const remote = resolveFetchRemoteForRemotes(remotes, upstream)
  if (!remote) return { ok: true, message: '' }
  return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'fetch', '--prune', '--', remote)
}

export async function pullBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
): Promise<GitPullResult> {
  if (!isSafeBranchName(branch)) return { ok: false, message: 'error.invalid-arguments' }
  if (worktreePath) {
    const result = await gitResultWithOptions(
      worktreePath,
      { timeoutMs: NETWORK_TIMEOUT_MS, signal },
      'pull',
      '--ff-only',
    )
    return result.ok || result.repositoryStateChanged ? { ...result, affectedWorktreePaths: [worktreePath] } : result
  }
  const current = await getCurrentBranch(cwd, { signal })
  if (signal?.aborted) return { ok: false, message: 'cancelled' }
  if (branch === current) {
    const result = await gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'pull', '--ff-only')
    return result.ok || result.repositoryStateChanged ? { ...result, affectedWorktreePaths: [cwd] } : result
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
