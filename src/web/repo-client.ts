import { openExternalUrl } from '#/web/app-shell-client.ts'
import { getServerJson, postServerJson } from '#/web/lib/server-fetch.ts'
import type { CloneRepoResult, PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import type { ExecResult, PullRequestFetchMode, WorktreeStatus } from '#/shared/git-types.ts'
import type { ProbeResult } from '#/shared/api-types.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'

export async function probeRepository(cwd: string, signal?: AbortSignal): Promise<ProbeResult> {
  return await getServerJson('/api/repo/probe', { cwd }, { signal })
}

export async function cloneRepository(input: {
  operationId: string
  url: string
  parentPath: string
  directoryName: string
}): Promise<CloneRepoResult> {
  return await postServerJson('/api/repo/clone', input)
}

export async function abortCloneOperation(operationId: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort-clone', { operationId })
}

export async function getRepositorySnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot | null> {
  return await getServerJson('/api/repo/snapshot', { cwd }, { signal })
}

export async function getRepositoryStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  return await getServerJson('/api/repo/status', { cwd }, { signal })
}

export async function getRepositoryRemoteBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  return await postServerJson('/api/repo/remote-branches', { cwd }, { signal })
}

export async function getRepositoryPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode },
  signal?: AbortSignal,
): Promise<PullRequestEntry[] | null> {
  return await getServerJson('/api/repo/pull-requests', { cwd, branches, mode: options?.mode }, { signal })
}

export async function abortRepositoryOperation(cwd: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort', { cwd })
}

export async function fetchRepository(
  cwd: string,
  kind?: 'user' | 'background',
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<{ ok: boolean; message: string }> {
  return await postServerJson('/api/repo/fetch', kind ? { cwd, kind, sourceToken } : { cwd, sourceToken }, { signal })
}

export async function pullRepositoryBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/pull', { cwd, branch, worktreePath, sourceToken }, { signal })
}

export async function pushRepositoryBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/push', { cwd, branch, sourceToken }, { signal })
}

export async function createRepositoryWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/create-worktree', { cwd, ...input, sourceToken }, { signal })
}

export async function deleteRepositoryBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/delete-branch',
    { cwd, branch, force: options?.force, alsoDeleteUpstream: options?.alsoDeleteUpstream, sourceToken },
    { signal },
  )
}

export async function removeRepositoryWorktree(
  cwd: string,
  options: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
  },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/remove-worktree', { cwd, ...options, sourceToken }, { signal })
}

export async function getRepositoryPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await getServerJson('/api/repo/patch', { cwd, worktreePath }, { signal })
}

export interface RepositoryComposite {
  snapshot: RepoSnapshot | null
  status: WorktreeStatus[]
  pullRequests: PullRequestEntry[] | null
}

/**
 * Fetch several repo read results in one round trip. The renderer's
 * refresh flow collapses the three calls (snapshot + status + PRs)
 * into a single network request.
 */
export async function getRepositoryComposite(
  cwd: string,
  options: {
    include?: ReadonlyArray<'snapshot' | 'status' | 'pullRequests'>
    branches?: string[]
    mode?: PullRequestFetchMode
    signal?: AbortSignal
    /** Per-section timeout in ms forwarded to the server. `0` disables. */
    timeoutMs?: number
  } = {},
): Promise<RepositoryComposite> {
  return await getServerJson(
    '/api/repo/composite',
    {
      cwd,
      include: [...(options.include ?? ['snapshot', 'status', 'pullRequests'])],
      branches: options.branches,
      mode: options.mode,
      timeoutMs: options.timeoutMs,
    },
    { signal: options.signal },
  )
}

export async function openRepositoryRemote(cwd: string, branch?: string): Promise<ExecResult> {
  const result = await postServerJson<{ cwd: string; branch?: string }, ExecResult>(
    '/api/repo/open-remote',
    branch ? { cwd, branch } : { cwd },
  )
  if (!result.ok || !result.message) return result
  const opened = await openExternalUrl(result.message)
  return opened.ok ? { ok: true, message: '' } : opened
}

export async function openRepositoryTerminal(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-terminal', { path })
}

export async function openRepositoryEditor(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-editor', { path })
}

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await postServerJson('/api/repo/background-sync-repos', { repoIds })
}
