import { git, gitResultWithOptions, NETWORK_TIMEOUT_MS } from '#/main/git/helper.ts'
import type { ExecResult } from '#/main/git/types.ts'
import { getCurrentBranch } from '#/main/git/branches.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'

function remoteUrlToHttps(url: string): string | null {
  const sshUrl = url.match(/^ssh:\/\/(?:[^@]+@)?([^:/]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (sshUrl) return `https://${sshUrl[1]}/${sshUrl[2]}`

  const httpsUrl = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (httpsUrl) return `https://${httpsUrl[1]}/${httpsUrl[2]}`

  const scpUrl = url.match(/^(?:[^@]+@)?([^:/\s]+):([^/].*?)(?:\.git)?\/?$/)
  if (scpUrl) return `https://${scpUrl[1]}/${scpUrl[2]}`

  return null
}

export async function getGitHubUrl(cwd: string): Promise<string | null> {
  try {
    const url = await git(cwd, ['remote', 'get-url', 'origin'])
    if (!url) return null
    return remoteUrlToHttps(url)
  } catch {
    return null
  }
}

export async function getPullRequestUrl(cwd: string, branch: string): Promise<string | null> {
  const repoUrl = await getGitHubUrl(cwd)
  if (!repoUrl) return null
  const encoded = branch.split('/').map(encodeURIComponent).join('/')
  // `/pull/new/{branch}` redirects to the existing open PR if one is
  // associated with the branch; otherwise it lands on GitHub's "create
  // pull request" page pre-populated with that branch as the head. This
  // single URL covers both intents the user has when clicking "Open in
  // GitHub" from a branch row — see an existing PR, or start one.
  return `${repoUrl}/pull/new/${encoded}`
}

async function hasOrigin(cwd: string): Promise<boolean> {
  return hasRemote(cwd, 'origin')
}

async function hasRemote(cwd: string, remote: string): Promise<boolean> {
  try {
    const url = await git(cwd, ['remote', 'get-url', '--', remote])
    return url.length > 0
  } catch {
    return false
  }
}

async function getUpstreamParts(cwd: string, branch: string): Promise<{ remote: string; branch: string } | null> {
  try {
    const [remote, mergeRef] = await Promise.all([
      git(cwd, ['config', '--get', `branch.${branch}.remote`]),
      git(cwd, ['config', '--get', `branch.${branch}.merge`]),
    ])
    const remoteBranch = mergeRef.startsWith('refs/heads/') ? mergeRef.slice('refs/heads/'.length) : ''
    if (!remote || !remoteBranch || !isSafeBranchName(remoteBranch)) return null
    return { remote, branch: remoteBranch }
  } catch {
    return null
  }
}

export async function fetchAll(cwd: string, signal?: AbortSignal): Promise<ExecResult> {
  if (!(await hasOrigin(cwd))) return { ok: false, message: 'No origin remote configured' }
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
  const current = await getCurrentBranch(cwd)
  if (branch === current) {
    return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'pull', '--ff-only')
  }
  const target = await getUpstreamParts(cwd, branch)
  if (!target) return { ok: false, message: 'error.invalid-arguments' }
  if (target.remote !== '.' && !(await hasRemote(cwd, target.remote))) {
    return { ok: false, message: `No ${target.remote} remote configured` }
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
  if (!(await hasOrigin(cwd))) return { ok: false, message: 'No origin remote configured' }
  return gitResultWithOptions(cwd, { timeoutMs: NETWORK_TIMEOUT_MS, signal }, 'push', '-u', 'origin', branch)
}
