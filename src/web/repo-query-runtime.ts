import type { QueryClient } from '@tanstack/react-query'
import type {
  RepoOperationsSnapshot,
  RepoPullRequestScope,
  RepoPullRequestsResponse,
  RepoSnapshotResponse,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { getRepoOperations, getRepoPullRequests, getRepoSnapshot, getRepoWorktreeStatus } from '#/web/repo-client.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { waitForPromiseWithSignal } from '#/web/lib/abort.ts'
import {
  repoDataQueryKey,
  repoOperationsQueryKey,
  repoOperationsQueryPrefix,
  repoPullRequestsQueryPrefix,
  repoSnapshotQueryKey,
  repoWorktreeStatusQueryKey,
} from '#/web/repo-query-keys.ts'

class StaleRepoRuntimeReadError extends Error {
  constructor() {
    super('Stale workspace runtime read')
    this.name = 'StaleRepoRuntimeReadError'
  }
}

class MismatchedRepoRuntimeReadError extends Error {
  constructor() {
    super('error.failed-read-repo', { cause: new Error('Mismatched workspace runtime read') })
    this.name = 'MismatchedRepoRuntimeReadError'
  }
}

const metadataVersions = new WeakMap<QueryClient, Map<string, number>>()
const statusVersions = new WeakMap<QueryClient, Map<string, number>>()
const operationVersions = new WeakMap<QueryClient, Map<string, number>>()

function scopeKey(repoRoot: WorkspaceId, workspaceRuntimeId: string): string {
  return `${repoRoot}\0${workspaceRuntimeId}`
}

function versionMap(owner: WeakMap<QueryClient, Map<string, number>>, client: QueryClient): Map<string, number> {
  let map = owner.get(client)
  if (!map) {
    map = new Map()
    owner.set(client, map)
  }
  return map
}

function version(
  owner: WeakMap<QueryClient, Map<string, number>>,
  client: QueryClient,
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
): number {
  return versionMap(owner, client).get(scopeKey(repoRoot, workspaceRuntimeId)) ?? 0
}

function bump(
  owner: WeakMap<QueryClient, Map<string, number>>,
  client: QueryClient,
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
): void {
  const map = versionMap(owner, client)
  const key = scopeKey(repoRoot, workspaceRuntimeId)
  map.set(key, (map.get(key) ?? 0) + 1)
}

export function disposeRepoRuntimeReadState(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  client: QueryClient = primaryWindowQueryClient,
): void {
  const key = scopeKey(repoRoot, workspaceRuntimeId)
  metadataVersions.get(client)?.delete(key)
  statusVersions.get(client)?.delete(key)
  operationVersions.get(client)?.delete(key)
}

async function currentRead<T>(
  owner: WeakMap<QueryClient, Map<string, number>>,
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  client: QueryClient,
  read: () => Promise<T>,
): Promise<T> {
  const started = version(owner, client, repoRoot, workspaceRuntimeId)
  try {
    const result = await read()
    signal.throwIfAborted()
    if (started < version(owner, client, repoRoot, workspaceRuntimeId)) throw new StaleRepoRuntimeReadError()
    return result
  } catch (error) {
    signal.throwIfAborted()
    if (started < version(owner, client, repoRoot, workspaceRuntimeId)) throw new StaleRepoRuntimeReadError()
    throw error
  }
}

export function isStaleRepoRuntimeReadError(error: unknown): boolean {
  return error instanceof StaleRepoRuntimeReadError
}

export async function fetchRepoSnapshotReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  client: QueryClient,
): Promise<RepoSnapshotResponse> {
  return await currentRead(
    metadataVersions,
    repoRoot,
    workspaceRuntimeId,
    signal,
    client,
    async () => await getRepoSnapshot(repoRoot, workspaceRuntimeId, signal),
  )
}

export async function fetchRepoPullRequestsReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  scope: RepoPullRequestScope,
  signal: AbortSignal,
  client: QueryClient,
): Promise<RepoPullRequestsResponse> {
  return await getRepoPullRequests(repoRoot, workspaceRuntimeId, scope, signal)
}

export async function fetchRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  client: QueryClient,
): Promise<RepoWorktreeStatusSnapshot> {
  const snapshot = await currentRead(
    statusVersions,
    repoRoot,
    workspaceRuntimeId,
    signal,
    client,
    async () => await getRepoWorktreeStatus(repoRoot, workspaceRuntimeId, signal),
  )
  if (snapshot.workspaceRuntimeId !== workspaceRuntimeId) throw new MismatchedRepoRuntimeReadError()
  return snapshot
}

export async function fetchRepoOperationsReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  includeSettled: boolean,
  signal: AbortSignal,
  client: QueryClient,
): Promise<RepoOperationsSnapshot> {
  return await currentRead(
    operationVersions,
    repoRoot,
    workspaceRuntimeId,
    signal,
    client,
    async () => await getRepoOperations(repoRoot, workspaceRuntimeId, { includeSettled, signal }),
  )
}

export async function fetchRepoMetadataQuery<T>(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  signal: AbortSignal,
  client: QueryClient,
  read: () => Promise<T>,
): Promise<T> {
  return await currentRead(metadataVersions, repoRoot, workspaceRuntimeId, signal, client, read)
}

export async function refreshRepoSnapshotReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { signal?: AbortSignal; queryClient?: QueryClient } = {},
): Promise<RepoSnapshotResponse> {
  options.signal?.throwIfAborted()
  const client = options.queryClient ?? primaryWindowQueryClient
  const queryKey = repoSnapshotQueryKey(repoRoot, workspaceRuntimeId)
  await client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' }, { cancelRefetch: false })
  options.signal?.throwIfAborted()
  const sharedRead = client.fetchQuery({
    queryKey,
    staleTime: 0,
    retry: (_count, error) => isStaleRepoRuntimeReadError(error),
    retryDelay: 0,
    queryFn: ({ signal }) => fetchRepoSnapshotReadModel(repoRoot, workspaceRuntimeId, signal, client),
  })
  return options.signal ? await waitForPromiseWithSignal(sharedRead, options.signal) : await sharedRead
}

export function refreshActiveRepoPullRequestQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { queryClient?: QueryClient } = {},
): Promise<void> {
  const client = options.queryClient ?? primaryWindowQueryClient
  return client.refetchQueries({
    queryKey: repoPullRequestsQueryPrefix(repoRoot, workspaceRuntimeId),
    type: 'active',
  })
}

export async function refreshRepoWorktreeStatusReadModel(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  options: { signal?: AbortSignal; queryClient?: QueryClient } = {},
): Promise<RepoWorktreeStatusSnapshot> {
  options.signal?.throwIfAborted()
  const client = options.queryClient ?? primaryWindowQueryClient
  const queryKey = repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId)
  await client.invalidateQueries({ queryKey, exact: true, refetchType: 'none' }, { cancelRefetch: false })
  options.signal?.throwIfAborted()
  const sharedRead = client.fetchQuery({
    queryKey,
    staleTime: 0,
    retry: (_count, error) => isStaleRepoRuntimeReadError(error),
    retryDelay: 0,
    queryFn: ({ signal }) => fetchRepoWorktreeStatusReadModel(repoRoot, workspaceRuntimeId, signal, client),
  })
  return options.signal ? await waitForPromiseWithSignal(sharedRead, options.signal) : await sharedRead
}

export function invalidateRepoMetadataQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  client: QueryClient = primaryWindowQueryClient,
): void {
  bump(metadataVersions, client, repoRoot, workspaceRuntimeId)
  void client.invalidateQueries(
    {
      queryKey: repoDataQueryKey(repoRoot, workspaceRuntimeId),
      refetchType: 'active',
      predicate: (query) => ['snapshot', 'log', 'remote-branches'].includes(String(query.queryKey[3])),
    },
    { cancelRefetch: false },
  )
}

export function invalidateRepoWorktreeStatusQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  client: QueryClient = primaryWindowQueryClient,
): void {
  bump(statusVersions, client, repoRoot, workspaceRuntimeId)
  void client.invalidateQueries(
    { queryKey: repoWorktreeStatusQueryKey(repoRoot, workspaceRuntimeId) },
    { cancelRefetch: false },
  )
}

export function invalidateRepoOperationsQueries(
  repoRoot: WorkspaceId,
  workspaceRuntimeId: string,
  client: QueryClient = primaryWindowQueryClient,
): void {
  bump(operationVersions, client, repoRoot, workspaceRuntimeId)
  void client.invalidateQueries(
    { queryKey: repoOperationsQueryPrefix(repoRoot, workspaceRuntimeId), refetchType: 'active' },
    { cancelRefetch: false },
  )
}
