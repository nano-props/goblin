import { openExternalUrl } from '#/web/app-shell-client.ts'
import { SERVER_REQUEST_TIMEOUT_ERROR, postServerJson } from '#/web/lib/server-fetch.ts'
import type {
  CloneRepoResult,
  RepoOperationsSnapshot,
  GitWorkspaceRuntimeProjection,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { ExecResult, LogEntry, PullRequestFetchMode, RepoUrlTarget } from '#/shared/git-types.ts'
import { DEFAULT_REPOSITORY_LOG_COUNT } from '#/shared/git-types.ts'
import type { CreateWorktreeInput } from '#/shared/worktree-create.ts'
import type { WorktreeBootstrapDecision, WorktreeBootstrapPreviewResult } from '#/shared/worktree-bootstrap-summary.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitBackgroundSyncTarget } from '#/shared/git-background-sync.ts'
import { readClientPageId } from '#/web/client-page-id.ts'
import { ExecResultResponseSchema } from '#/shared/http-response-schema.ts'
import { decodeWith } from '#/shared/http-response-schema.ts'
import {
  BackgroundSyncReposResponseSchema,
  CloneRepoResponseSchema,
  RepoLogResponseSchema,
  RepoOperationsResponseSchema,
  RepoProjectionResponseSchema,
  RepoRemoteBranchesResponseSchema,
  RepoWorktreeStatusResponseSchema,
  WorktreeBootstrapPreviewResponseSchema,
} from '#/shared/repo-response-schema.ts'

const REPO_REQUEST_TIMEOUT_MS = {
  gitNetwork: 240_000,
  clone: 360_000,
  branchMutation: 240_000,
  removeWorktree: 10 * 60_000,
  worktreeCreate: 15 * 60_000,
  patch: 15 * 60_000,
} as const

let backgroundSyncRegistrationRevision = 0

async function runRepoReadWithStableErrorKey<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await read()
  } catch (err) {
    if (signal?.aborted) throw err
    if (err instanceof Error && err.message === SERVER_REQUEST_TIMEOUT_ERROR) throw err
    throw new Error('error.failed-read-repo', { cause: err })
  }
}

export async function cloneRepository(
  input: {
    url: string
    parentPath: string
    directoryName: string
  },
  options?: { signal?: AbortSignal },
): Promise<CloneRepoResult> {
  try {
    return await postServerJson('/api/repo/clone', input, decodeWith(CloneRepoResponseSchema), {
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
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options?: { count?: number; skip?: number; signal?: AbortSignal },
): Promise<LogEntry[]> {
  const log = await postServerJson(
    '/api/repo/log',
    {
      cwd,
      workspaceRuntimeId,
      branch,
      count: options?.count ?? DEFAULT_REPOSITORY_LOG_COUNT,
      skip: options?.skip ?? 0,
    },
    decodeWith(RepoLogResponseSchema),
    { signal: options?.signal },
  )
  if (Array.isArray(log)) return log
  throw new Error(log.message)
}

export async function getRepoRemoteBranches(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return await postServerJson(
    '/api/repo/remote-branches',
    { cwd, workspaceRuntimeId },
    decodeWith(RepoRemoteBranchesResponseSchema),
    { signal },
  )
}

export async function getRepoProjection(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  branch?: string | null,
  options?: { mode?: PullRequestFetchMode },
  signal?: AbortSignal,
): Promise<GitWorkspaceRuntimeProjection> {
  return await postServerJson(
    '/api/repo/projection',
    { cwd, workspaceRuntimeId, branch: branch || undefined, mode: options?.mode },
    decodeWith(RepoProjectionResponseSchema),
    { signal },
  )
}

export async function getRepoWorktreeStatus(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<RepoWorktreeStatusSnapshot> {
  return await runRepoReadWithStableErrorKey(
    async () =>
      await postServerJson(
        '/api/repo/worktree-status',
        { cwd, workspaceRuntimeId },
        decodeWith(RepoWorktreeStatusResponseSchema),
        { signal },
      ),
    signal,
  )
}

export async function getRepoOperations(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  options?: { includeSettled?: boolean; signal?: AbortSignal },
): Promise<RepoOperationsSnapshot> {
  return await postServerJson(
    '/api/repo/operations',
    { cwd, workspaceRuntimeId, includeSettled: options?.includeSettled },
    decodeWith(RepoOperationsResponseSchema),
    { signal: options?.signal },
  )
}

export async function fetchRepo(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message: string }> {
  return await postServerJson(
    '/api/repo/fetch',
    { cwd, workspaceRuntimeId },
    decodeWith(ExecResultResponseSchema),
    {
      signal,
      timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork,
    },
  )
}

export async function pullRepoBranch(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  worktreePath?: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/pull',
    { cwd, workspaceRuntimeId, branch, worktreePath },
    decodeWith(ExecResultResponseSchema),
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork },
  )
}

export async function pushRepoBranch(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/push',
    { cwd, workspaceRuntimeId, branch },
    decodeWith(ExecResultResponseSchema),
    {
      signal,
      timeoutMs: REPO_REQUEST_TIMEOUT_MS.gitNetwork,
    },
  )
}

export async function createRepoWorktree(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  input: CreateWorktreeInput,
  worktreeBootstrap: WorktreeBootstrapDecision,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/create-worktree',
    { cwd, workspaceRuntimeId, ...input, worktreeBootstrap },
    decodeWith(ExecResultResponseSchema),
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.worktreeCreate },
  )
}

export async function getRepoWorktreeBootstrapPreview(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  signal?: AbortSignal,
): Promise<WorktreeBootstrapPreviewResult> {
  return await postServerJson(
    '/api/repo/worktree-bootstrap-preview',
    { cwd, workspaceRuntimeId },
    decodeWith(WorktreeBootstrapPreviewResponseSchema),
    { signal },
  )
}

export async function deleteRepoBranch(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  branch: string,
  options?: { force?: boolean; deleteUpstream?: boolean },
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/delete-branch',
    { cwd, workspaceRuntimeId, branch, force: options?.force, deleteUpstream: options?.deleteUpstream },
    decodeWith(ExecResultResponseSchema),
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.branchMutation },
  )
}

export async function removeRepoWorktree(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  options: {
    branch: string
    worktreePath: string
    deleteBranch: boolean
    forceDeleteBranch?: boolean
    deleteUpstream?: boolean
  },
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/remove-worktree',
    { cwd, workspaceRuntimeId, ...options },
    decodeWith(ExecResultResponseSchema),
    {
      signal,
      timeoutMs: REPO_REQUEST_TIMEOUT_MS.removeWorktree,
    },
  )
}

export async function getRepoPatch(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<ExecResult> {
  return await postServerJson(
    '/api/repo/patch',
    { cwd, workspaceRuntimeId, worktreePath },
    decodeWith(ExecResultResponseSchema),
    { signal, timeoutMs: REPO_REQUEST_TIMEOUT_MS.patch },
  )
}

export async function openRepoUrl(
  cwd: WorkspaceId,
  workspaceRuntimeId: string,
  target: RepoUrlTarget,
): Promise<ExecResult> {
  const result = await postServerJson(
    '/api/repo/open-url',
    { cwd, workspaceRuntimeId, target },
    decodeWith(ExecResultResponseSchema),
  )
  if (!result.ok || !result.message) return result
  const opened = await openExternalUrl(result.message)
  return opened.ok ? { ok: true, message: '' } : opened
}

export async function setBackgroundSyncRepos(targets: GitBackgroundSyncTarget[], signal?: AbortSignal): Promise<void> {
  await postServerJson(
    '/api/repo/background-sync-repos',
    {
      clientId: readClientPageId(),
      revision: nextBackgroundSyncRegistrationRevision(),
      targets,
    },
    decodeWith(BackgroundSyncReposResponseSchema),
    { signal },
  )
}

function nextBackgroundSyncRegistrationRevision(): number {
  backgroundSyncRegistrationRevision += 1
  return backgroundSyncRegistrationRevision
}
