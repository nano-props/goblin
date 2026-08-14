import { mapWithConcurrency } from '#/system/git/concurrency.ts'
import {
  getRepoUrlForRemotes,
  parseRemoteVerbose,
  repoRemoteInfoForRemotes,
  resolveFetchRemoteForRemotes,
  resolvePushTargetForRemotes,
} from '#/system/git/remote.ts'
import type { UpstreamParts } from '#/system/git/remote.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import { withoutMutationCommand } from '#/system/command-execution.ts'
import type { CommandOutcome } from '#/system/command-execution.ts'
import { parseRemoteCurrentBranch } from '#/system/ssh/git/codec.ts'
import { GIT_OBJECT_ID_OR_PREFIX_RE } from '#/shared/git-types.ts'
import type { ExecResult, GitRemoteInfo, RepoRemoteInfo, RepoUrlTarget } from '#/shared/git-types.ts'
import { decodeGitUpstream } from '#/system/git/upstream.ts'
import type { GitUpstream } from '#/system/git/upstream.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { isSafeBranchName } from '#/shared/refnames.ts'
import { parseRemoteTrackingRefs } from '#/shared/worktree-create.ts'
import type { RemoteFetchAuthority, RemoteTrackingBranchIdentity } from '#/shared/worktree-create.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'
import { remoteCommandOutcome } from '#/system/ssh/command-execution.ts'
import { REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS } from '#/system/ssh/git/timeouts.ts'

const REMOTE_FETCH_SPEC_CONCURRENCY = 8

export async function fetchRemoteRepo(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<CommandOutcome> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const currentBranch = await getRemoteCurrentBranch(target, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  const [remotes, upstream] = await Promise.all([
    getRemoteRemotes(target, { signal: options.signal, run }),
    currentBranch
      ? getRemoteUpstreamParts(target, currentBranch, { signal: options.signal, run })
      : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if (remotes.length === 0) return withoutMutationCommand({ ok: true, message: '' })
  const remote = resolveFetchRemoteForRemotes(remotes, upstream)
  if (!remote) return withoutMutationCommand({ ok: true, message: '' })
  const result = await run({ type: 'gitFetchRemote', path: target.remotePath, remote }, target, {
    signal: options.signal,
    timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS,
  })
  return remoteCommandOutcome(result)
}

export async function pushRemoteBranch(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<CommandOutcome> {
  if (!isSafeBranchName(branch)) return withoutMutationCommand({ ok: false, message: 'error.invalid-arguments' })
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const pushTarget = await resolveRemotePushTarget(target, branch, { signal: options.signal, run })
  if (options.signal?.aborted) return withoutMutationCommand({ ok: false, message: 'cancelled' })
  if ('ok' in pushTarget) return withoutMutationCommand(pushTarget)
  const result = await run(
    {
      type: 'gitPush',
      path: target.remotePath,
      remote: pushTarget.remote,
      branch,
      targetBranch: pushTarget.branch,
      setUpstream: pushTarget.setUpstream,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS },
  )
  return remoteCommandOutcome(result)
}

export async function getRemoteTrackingBranches(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<RemoteTrackingBranchIdentity[]> {
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const authority = await readRemoteTrackingAuthority(target, { signal: options.signal, run })
  options.signal?.throwIfAborted()
  try {
    return parseRemoteTrackingRefs(authority.refs, authority.remotes)
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

async function readRemoteTrackingAuthority(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<{ refs: string; remotes: RemoteFetchAuthority[] }> {
  const [result, remotes] = await Promise.all([
    options.run({ type: 'gitRemoteBranches', path: target.remotePath }, target, { signal: options.signal }),
    getRemoteRemotes(target, options),
  ])
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const authorities = await mapWithConcurrency(
    remotes,
    REMOTE_FETCH_SPEC_CONCURRENCY,
    async (remote): Promise<RemoteFetchAuthority> => {
      const specs = await options.run(
        { type: 'gitRemoteFetchSpecs', path: target.remotePath, remote: remote.name },
        target,
        { signal: options.signal },
      )
      options.signal?.throwIfAborted()
      if (!specs.ok) throw new Error(specs.message || 'error.failed-read-repo')
      return { name: remote.name, fetchSpecs: specs.stdout ? specs.stdout.split('\n') : [] }
    },
    { signal: options.signal, abort: 'throw' },
  )
  return { refs: result.stdout, remotes: authorities }
}

export async function getRemoteBrowserUrl(
  target: RemoteWorkspaceTarget,
  urlTarget: RepoUrlTarget,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<string | null> {
  if (urlTarget.type === 'branch' && !isSafeBranchName(urlTarget.branch)) return null
  if (urlTarget.type === 'commit' && !GIT_OBJECT_ID_OR_PREFIX_RE.test(urlTarget.hash)) return null
  const run: RemoteCommandRunner = options.run ?? ((command, t, runOptions) => runRemoteCommand(t, command, runOptions))
  const branch = urlTarget.type === 'branch' ? urlTarget.branch : undefined
  const [remoteInfo, upstream] = await Promise.all([
    getRemoteRepoInfo(target, { signal: options.signal, run }),
    branch ? getRemoteUpstreamParts(target, branch, { signal: options.signal, run }) : Promise.resolve(null),
  ])
  if (options.signal?.aborted) return null
  return getRepoUrlForRemotes(remoteInfo.remotes, urlTarget, upstream)
}

export async function getRemoteUpstream(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteCommandRunner; path?: string },
): Promise<GitUpstream | null> {
  const result = await options.run({ type: 'gitUpstream', path: options.path ?? target.remotePath, branch }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  try {
    return decodeGitUpstream(result.stdout)
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

export async function getRemoteRemotes(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<GitRemoteInfo[]> {
  const result = await options.run({ type: 'gitRemoteVerbose', path: target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  try {
    return parseRemoteVerbose(result.stdout)
  } catch {
    throw new Error('error.failed-read-repo')
  }
}

export async function getRemoteCurrentBranch(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteCommandRunner; path?: string },
): Promise<string> {
  const result = await options.run({ type: 'gitSnapshot', path: options.path ?? target.remotePath }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const current = parseRemoteCurrentBranch(result.stdout)
  if (current === null) throw new Error('error.failed-read-repo')
  return current
}

export async function getRemoteUpstreamParts(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteCommandRunner; path?: string },
): Promise<UpstreamParts | null> {
  const upstream = await getRemoteUpstream(target, branch, options)
  return upstream?.source ?? null
}

export async function deleteRemoteUpstreamBranch(
  target: RemoteWorkspaceTarget,
  gitPath: string,
  upstream: GitUpstream | null,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<CommandOutcome | null> {
  if (!upstream?.deleteTarget) return null
  const result = await options.run(
    {
      type: 'gitPushDeleteBranch',
      path: gitPath,
      remote: upstream.deleteTarget.remote,
      branch: upstream.deleteTarget.branch,
    },
    target,
    { signal: options.signal, timeoutMs: REMOTE_GIT_BRANCH_OPERATION_TIMEOUT_MS },
  )
  return remoteCommandOutcome(result)
}

export async function getRemoteRepoInfo(
  target: RemoteWorkspaceTarget,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<RepoRemoteInfo> {
  return repoRemoteInfoForRemotes(await getRemoteRemotes(target, options))
}

export async function getRemoteBranchMergeFacts(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: {
    signal?: AbortSignal
    run: RemoteCommandRunner
    currentBranch?: string
    path?: string
    upstream: GitUpstream | null
  },
): Promise<{ mergedToCurrent: boolean; mergedToUpstream: boolean }> {
  const gitPath = options.path ?? target.remotePath
  let mergedToCurrent = false
  if (options.currentBranch) {
    mergedToCurrent = await getRemoteIsAncestor(target, branch, options.currentBranch, {
      signal: options.signal,
      run: options.run,
      path: gitPath,
    })
  }
  let mergedToUpstream = false
  if (options.upstream?.ancestryRef) {
    mergedToUpstream = await getRemoteIsAncestor(target, branch, options.upstream.ancestryRef, {
      signal: options.signal,
      run: options.run,
      path: gitPath,
    })
  }
  return { mergedToCurrent, mergedToUpstream }
}

async function getRemoteIsAncestor(
  target: RemoteWorkspaceTarget,
  ancestor: string,
  descendant: string,
  options: { signal?: AbortSignal; run: RemoteCommandRunner; path: string },
): Promise<boolean> {
  const result = await options.run({ type: 'gitIsAncestor', path: options.path, ancestor, descendant }, target, {
    signal: options.signal,
  })
  options.signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.message || 'error.failed-read-repo')
  const value = result.stdout.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error('error.failed-read-repo')
}

async function resolveRemotePushTarget(
  target: RemoteWorkspaceTarget,
  branch: string,
  options: { signal?: AbortSignal; run: RemoteCommandRunner },
): Promise<{ remote: string; branch: string; setUpstream: boolean } | ExecResult> {
  const [remotes, upstream] = await Promise.all([
    getRemoteRemotes(target, options),
    getRemoteUpstreamParts(target, branch, options),
  ])
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  return resolvePushTargetForRemotes(remotes, upstream, branch)
}
