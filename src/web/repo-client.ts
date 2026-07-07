import { openExternalUrl } from '#/web/app-shell-client.ts'
import { SERVER_REQUEST_TIMEOUT_ERROR, postServerJson } from '#/web/lib/server-fetch.ts'
import type {
  CloneRepoResult,
  PullRequestEntry,
  RepoRuntimeInstancesSnapshot,
  RepoRuntimeOpenResult,
  RepoSnapshot,
  RepoLogResponse,
} from '#/shared/api-types.ts'
import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import type { ExecResult, LogEntry, PullRequestFetchMode, RepoUrlTarget, WorktreeStatus } from '#/shared/git-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { ProbeResult } from '#/shared/api-types.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'

const REPO_REQUEST_TIMEOUT_MS = {
  gitNetwork: 240_000,
  clone: 360_000,
  branchMutation: 240_000,
  removeWorktree: 10 * 60_000,
  worktreeCreate: 15 * 60_000,
  patch: 15 * 60_000,
} as const

export async function probeRepo(cwd: string, signal?: AbortSignal): Promise<ProbeResult> {
  return await postServerJson('/api/repo/probe', { cwd }, { signal })
}

export async function cloneRepository(input: {
  operationId: string
  url: string
  parentPath: string
  directoryName: string
}): Promise<CloneRepoResult> {
  try {
    return await postServerJson('/api/repo/clone', input, { timeoutMs: REPO_REQUEST_TIMEOUT_MS.clone })
  } catch (err) {
    if (err instanceof Error && err.message === SERVER_REQUEST_TIMEOUT_ERROR) {
      void abortCloneOperation(input.operationId).catch(() => {})
      return { ok: false, message: SERVER_REQUEST_TIMEOUT_ERROR }
    }
    throw err
  }
}

export async function abortCloneOperation(operationId: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort-clone', { operationId })
}

export async function getRepoSnapshot(cwd: string, signal?: AbortSignal): Promise<RepoSnapshot> {
  return await postServerJson('/api/repo/snapshot', { cwd }, { signal })
}

export async function getRepoStatus(cwd: string, signal?: AbortSignal): Promise<WorktreeStatus[]> {
  return await postServerJson('/api/repo/status', { cwd }, { signal })
}

export async function getRepoLog(
  cwd: string,
  branch: string,
  options?: { count?: number; skip?: number; signal?: AbortSignal },
): Promise<LogEntry[]> {
  const result = await postServerJson(
    '/api/repo/log',
    { cwd, branch, count: options?.count ?? DEFAULT_REPOSITORY_LOG_COUNT, skip: options?.skip ?? 0 },
    { signal: options?.signal },
  )
  const log = result as RepoLogResponse
  if (Array.isArray(log)) return log
  throw new Error(log.message)
}

export async function getRepoRemoteBranches(cwd: string, signal?: AbortSignal): Promise<string[]> {
  return await postServerJson('/api/repo/remote-branches', { cwd }, { signal })
}

export async function getRepoPullRequests(
  cwd: string,
  branches?: string[],
  options?: { mode?: PullRequestFetchMode },
  signal?: AbortSignal,
): Promise<PullRequestEntry[] | null> {
  return await postServerJson('/api/repo/pull-requests', { cwd, branches, mode: options?.mode }, { signal })
}

export async function abortRepoOperation(cwd: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort', { cwd })
}

export async function fetchRepo(
  cwd: string,
  kind?: 'user' | 'background',
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<{ ok: boolean; message: string }> {
  return await postServerJson('/api/repo/fetch', kind ? { cwd, kind, sourceToken } : { cwd, sourceToken }, {
    signal,
    timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork,
  })
}

export async function pullRepoBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/pull',
    { cwd, branch, worktreePath, sourceToken },
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork },
  )
}

export async function pushRepoBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/push', { cwd, branch, sourceToken }, {
    signal,
    timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork,
  })
}

export async function createRepoWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  worktreeBootstrap: WorktreeBootstrapDecision,
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/create-worktree',
    { cwd, ...input, sourceToken, worktreeBootstrap },
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.worktreeCreate },
  )
}

export async function getRepoWorktreeBootstrapPreview(
  cwd: string,
  signal?: AbortSignal,
): Promise<WorktreeBootstrapPreviewResult> {
  return await postServerJson('/api/repo/worktree-bootstrap-preview', { cwd }, { signal })
}

export async function deleteRepoBranch(
  cwd: string,
  branch: string,
  options?: { force?: boolean; alsoDeleteUpstream?: boolean },
  signal?: AbortSignal,
  sourceToken?: string,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/delete-branch',
    { cwd, branch, force: options?.force, alsoDeleteUpstream: options?.alsoDeleteUpstream, sourceToken },
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.branchMutation },
  )
}

export async function removeRepoWorktree(
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
  return await postServerJson('/api/repo/remove-worktree', { cwd, ...options, sourceToken }, {
    signal,
    timeoutMs: REPO_REQUEST_TIMEOUT_MS.removeWorktree,
  })
}

export async function getRepoPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await postServerJson('/api/repo/patch', { cwd, worktreePath }, { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.patch })
}

interface RepoBulkReadResult {
  snapshot: RepoSnapshot | null
  status: WorktreeStatus[]
  pullRequests: PullRequestEntry[] | null
}

/**
 * Fetch several repo read results in one round trip. The client's
 * refresh flow collapses the three calls (snapshot + status + PRs)
 * into a single network request.
 */
export async function readRepoBulk(
  cwd: string,
  options: {
    include?: ReadonlyArray<'snapshot' | 'status' | 'pullRequests'>
    branches?: string[]
    mode?: PullRequestFetchMode
    signal?: AbortSignal
    /** Per-section timeout in ms forwarded to the server. `0` disables. */
    timeoutMs?: number
  } = {},
): Promise<RepoBulkReadResult> {
  return await postServerJson(
    '/api/repo/composite',
    {
      cwd,
      include: options.include ? [...options.include] : undefined,
      branches: options.branches,
      mode: options.mode,
      timeoutMs: options.timeoutMs,
    },
    { signal: options.signal },
  )
}

export async function openRepoUrl(cwd: string, target: RepoUrlTarget): Promise<ExecResult> {
  const result = await postServerJson<{ cwd: string; target: RepoUrlTarget }, ExecResult>('/api/repo/open-url', {
    cwd,
    target,
  })
  if (!result.ok || !result.message) return result
  const opened = await openExternalUrl(result.message)
  return opened.ok ? { ok: true, message: '' } : opened
}

export async function openRepoTerminal(path: string, app: TerminalApp): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-terminal', { path, app })
}

export async function openRepoEditor(path: string, app: EditorApp): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-editor', { path, app })
}

export async function openRepoInFinder(path: string): Promise<ExecResult> {
  return await postServerJson('/api/repo/open-in-finder', { path })
}

export async function setBackgroundSyncRepos(repoIds: string[]): Promise<void> {
  await postServerJson('/api/repo/background-sync-repos', { repoIds })
}

export async function openRepoRuntimeInstance(repoRoot: string): Promise<string> {
  const result = await postServerJson<{ repoRoot: string }, { repoInstanceId: string }>('/api/repo/runtime-open', {
    repoRoot,
  })
  return result.repoInstanceId
}

export async function openRepoRuntimeForInput(repoInput: string): Promise<RepoRuntimeOpenResult> {
  return await postServerJson<{ repoInput: string }, RepoRuntimeOpenResult>('/api/repo/runtime-open', { repoInput })
}

export async function closeRepoRuntimeInstance(repoRoot: string, repoInstanceId: string): Promise<boolean> {
  const result = await postServerJson<{ repoRoot: string; repoInstanceId: string }, { ok: boolean; closed: boolean }>(
    '/api/repo/runtime-close',
    {
      repoRoot,
      repoInstanceId,
    },
  )
  return result.closed
}

export async function listRepoRuntimeInstances(signal?: AbortSignal): Promise<RepoRuntimeInstancesSnapshot> {
  return await postServerJson<{}, RepoRuntimeInstancesSnapshot>('/api/repo/runtime-list', {}, { signal })
}
