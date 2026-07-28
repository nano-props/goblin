import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import {
  getRepoOperationsQueryData,
  getRepoSnapshotQueryData,
  setRepoSnapshotQueryData,
} from '#/web/repo-query-cache.ts'
import {
  repoOperationsQueryKey,
  repoPullRequestsQueryKey,
  repoSnapshotQueryKey,
  repoWorktreeStatusQueryKey,
} from '#/web/repo-query-keys.ts'
import { repoSnapshotReadModelQueryOptions } from '#/web/repo-query-options.ts'
import {
  invalidateRepoOperationsQueries,
  invalidateRepoMetadataQueries,
  invalidateRepoWorktreeStatusQueries,
  disposeRepoRuntimeReadState,
  fetchRepoSnapshotReadModel,
  refreshRepoSnapshotReadModel,
} from '#/web/repo-query-runtime.ts'
import { repoOperationsForTest, WORKSPACE_ID } from '#/web/test-utils/repo-query-runtime.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoSnapshot: vi.fn(),
  getRepoPullRequests: vi.fn(),
  getRepoWorktreeStatus: vi.fn(),
  getRepoOperations: vi.fn(),
  getRepoLog: vi.fn(),
  getRepoRemoteBranches: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => repoClientMocks)

const REMOTE = {
  remotes: [],
  hasRemotes: false,
  hasBrowserRemote: false,
  remoteProviders: {},
  hasGitHubRemote: false,
}

function snapshot(current: string): RepoSnapshotResponse {
  return { snapshot: { branches: [], current, remote: REMOTE } }
}

beforeEach(() => {
  for (const mock of Object.values(repoClientMocks)) mock.mockReset()
})

describe('repository query authorities', () => {
  test('stores the runtime snapshot under a branch-independent key', () => {
    const client = new QueryClient()
    setRepoSnapshotQueryData(WORKSPACE_ID, 'repo-runtime-1', snapshot('main').snapshot, client)

    expect(getRepoSnapshotQueryData(WORKSPACE_ID, 'repo-runtime-1', client)?.current).toBe('main')
    expect(client.getQueryData(repoSnapshotQueryKey(WORKSPACE_ID, 'repo-runtime-1'))).toEqual(snapshot('main'))
  })

  test('uses exact, non-overlapping pull-request scope keys', () => {
    const branchA = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', {
      kind: 'branch-detail',
      branch: 'feature/a',
    })
    const branchB = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', {
      kind: 'branch-detail',
      branch: 'feature/b',
    })
    const summary = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', { kind: 'repository-summary' })

    expect(branchA).not.toEqual(branchB)
    expect(branchA).not.toEqual(summary)
  })

  test('disposes runtime read generations with the runtime query scope', async () => {
    const client = new QueryClient()
    const read = Promise.withResolvers<RepoSnapshotResponse>()
    repoClientMocks.getRepoSnapshot.mockReturnValue(read.promise)
    const pending = fetchRepoSnapshotReadModel(
      WORKSPACE_ID,
      'repo-runtime-disposed',
      new AbortController().signal,
      client,
    )
    invalidateRepoMetadataQueries(WORKSPACE_ID, 'repo-runtime-disposed', client)
    disposeRepoRuntimeReadState(WORKSPACE_ID, 'repo-runtime-disposed', client)
    read.resolve(snapshot('disposed'))

    await expect(pending).resolves.toEqual(snapshot('disposed'))
  })

  test('keeps snapshot, status, PR, and operations invalidation domains independent', async () => {
    const client = new QueryClient()
    const snapshotKey = repoSnapshotQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const statusKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const prKey = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', { kind: 'repository-summary' })
    const operationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    client.setQueryData(snapshotKey, snapshot('main'))
    client.setQueryData(statusKey, { workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    client.setQueryData(prKey, { pullRequests: [] })
    client.setQueryData(operationsKey, repoOperationsForTest(1))

    invalidateRepoMetadataQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    await Promise.resolve()
    expect(client.getQueryState(snapshotKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(statusKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(prKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(operationsKey)?.isInvalidated).toBe(false)

    invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    await Promise.resolve()
    expect(client.getQueryState(statusKey)?.isInvalidated).toBe(true)

    invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    await Promise.resolve()
    expect(client.getQueryState(operationsKey)?.isInvalidated).toBe(true)
  })

  test('reruns an active snapshot query invalidated during an in-flight read', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const reads: Array<PromiseWithResolvers<RepoSnapshotResponse>> = []
    repoClientMocks.getRepoSnapshot.mockImplementation(() => {
      const read = Promise.withResolvers<RepoSnapshotResponse>()
      reads.push(read)
      return read.promise
    })
    const observer = new QueryObserver(client, repoSnapshotReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1', true))
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))

    invalidateRepoMetadataQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    reads[0]!.resolve(snapshot('stale'))
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[1]!.resolve(snapshot('fresh'))
    await vi.waitFor(() =>
      expect(getRepoSnapshotQueryData(WORKSPACE_ID, 'repo-runtime-1', client)?.current).toBe('fresh'),
    )
    unsubscribe()
  })

  test('does not accept a snapshot read that started before an explicit refresh', async () => {
    const client = new QueryClient()
    const reads: Array<PromiseWithResolvers<RepoSnapshotResponse>> = []
    repoClientMocks.getRepoSnapshot.mockImplementation(() => {
      const read = Promise.withResolvers<RepoSnapshotResponse>()
      reads.push(read)
      return read.promise
    })
    const observer = new QueryObserver(client, repoSnapshotReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1', true))
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))

    const refresh = refreshRepoSnapshotReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient: client })
    reads[0]!.resolve(snapshot('before-refresh'))
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[1]!.resolve(snapshot('after-refresh'))

    await expect(refresh).resolves.toEqual(snapshot('after-refresh'))
    expect(getRepoSnapshotQueryData(WORKSPACE_ID, 'repo-runtime-1', client)?.current).toBe('after-refresh')
    unsubscribe()
  })

  test('forwards caller cancellation to an imperative cold snapshot refresh', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    repoClientMocks.getRepoSnapshot.mockImplementation(
      (_repoId: string, _runtimeId: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    )
    const controller = new AbortController()
    const refresh = refreshRepoSnapshotReadModel(WORKSPACE_ID, 'repo-runtime-1', {
      queryClient: client,
      signal: controller.signal,
    })
    controller.abort(new Error('caller cancelled'))
    await expect(refresh).rejects.toThrow('caller cancelled')
  })

  test('does not expose retained operations data after its query enters an error state', () => {
    const client = new QueryClient()
    const key = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    client.setQueryData(key, repoOperationsForTest(1))
    const query = client.getQueryCache().find({ queryKey: key, exact: true })
    if (!query) throw new Error('missing operations query')
    query.setState({ ...query.state, status: 'error', error: new Error('operations unavailable') })
    expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', client)).toBeUndefined()
  })
})
