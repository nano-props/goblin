import { openExternalUrl } from '#/web/app-shell-client.ts'
import { SERVER_REQUEST_TIMEOUT_ERROR, postServerJson } from '#/web/lib/server-fetch.ts'
import type {
  CloneRepoResult,
  RepoOperationsSnapshot,
  RepoRuntimeProjection,
  RepoRuntimesSnapshot,
  RepoRuntimeOpenResult,
  RepoLogResponse,
} from '#/shared/api-types.ts'
import type { EditorApp, TerminalApp } from '#/shared/api-types.ts'
import type { ExecResult, LogEntry, PullRequestFetchMode, RepoUrlTarget } from '#/shared/git-types.ts'
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
  url: string
  parentPath: string
  directoryName: string
}, options?: { signal?: AbortSignal }): Promise<CloneRepoResult> {
  try {
    return await postServerJson('/api/repo/clone', input, {
      signal: options?.signal,
      timeoutMs: REPO_REQUEST_TIMEOUT_MS.clone,
    })
  } catch (err) {
    if (err instanceof Error && err.message === SERVER_REQUEST_TIMEOUT_ERROR) {
      return { ok: false, message: SERVER_REQUEST_TIMEOUT_ERROR }
    }
    throw err
  }
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

export async function getRepoProjection(
  cwd: string,
  branch?: string | null,
  options?: { mode?: PullRequestFetchMode },
  signal?: AbortSignal,
): Promise<RepoRuntimeProjection> {
  return await postServerJson(
    '/api/repo/projection',
    { cwd, branch: branch || undefined, mode: options?.mode },
    { signal },
  )
}

export async function getRepoOperations(
  cwd: string,
  options?: { includeSettled?: boolean; signal?: AbortSignal },
): Promise<RepoOperationsSnapshot> {
  return await postServerJson(
    '/api/repo/operations',
    { cwd, includeSettled: options?.includeSettled },
    { signal: options?.signal },
  )
}

export async function abortRepoOperation(cwd: string): Promise<boolean> {
  return await postServerJson('/api/repo/abort', { cwd })
}

export async function fetchRepo(
  cwd: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  return await postServerJson('/api/repo/fetch', { cwd }, {
    signal,
    timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork,
  })
}

export async function pullRepoBranch(
  cwd: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/pull',
    { cwd, branch, worktreePath },
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork },
  )
}

export async function pushRepoBranch(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/push', { cwd, branch }, {
    signal,
    timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork,
  })
}

export async function createRepoWorktree(
  cwd: string,
  input: CreateWorktreeInput,
  worktreeBootstrap: WorktreeBootstrapDecision,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/create-worktree',
    { cwd, ...input, worktreeBootstrap },
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
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/delete-branch',
    { cwd, branch, force: options?.force, alsoDeleteUpstream: options?.alsoDeleteUpstream },
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.branchMutation },
  )
}

export async function removeRepoWorktree(
  cwd: string,
  repoRuntimeId: string,
  options: {
    branch: string
    worktreePath: string
    alsoDeleteBranch: boolean
    forceDeleteBranch?: boolean
    alsoDeleteUpstream?: boolean
  },
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson('/api/repo/remove-worktree', { cwd, repoRuntimeId, ...options }, {
    signal,
    timeoutMs: REPO_REQUEST_TIMEOUT_MS.removeWorktree,
  })
}

export async function getRepoPatch(cwd: string, worktreePath: string, signal?: AbortSignal): Promise<ExecResult> {
  return await postServerJson('/api/repo/patch', { cwd, worktreePath }, { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.patch })
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

export async function openRepoRuntime(repoRoot: string): Promise<string> {
  const result = await postServerJson<{ repoRoot: string }, { repoRuntimeId: string }>('/api/repo/runtime-open', {
    repoRoot,
  })
  return result.repoRuntimeId
}

export async function openRepoRuntimeForInput(repoInput: string): Promise<RepoRuntimeOpenResult> {
  return await postServerJson<{ repoInput: string }, RepoRuntimeOpenResult>('/api/repo/runtime-open', { repoInput })
}

export async function closeRepoRuntime(repoRoot: string, repoRuntimeId: string): Promise<boolean> {
  const result = await postServerJson<{ repoRoot: string; repoRuntimeId: string }, { ok: boolean; closed: boolean }>(
    '/api/repo/runtime-close',
    {
      repoRoot,
      repoRuntimeId,
    },
  )
  return result.closed
}

export async function listRepoRuntimes(signal?: AbortSignal): Promise<RepoRuntimesSnapshot> {
  return await postServerJson<{}, RepoRuntimesSnapshot>('/api/repo/runtime-list', {}, { signal })
}
