import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  RepoOperationsSnapshot,
  RepoPullRequestsResponse,
  RepoSnapshotResponse,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
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
import {
  repoOperationsReadModelQueryOptions,
  repoPullRequestsReadModelQueryOptions,
  repoSnapshotReadModelQueryOptions,
  repoWorktreeStatusReadModelQueryOptions,
} from '#/web/repo-query-options.ts'
import {
  invalidateRepoOperationsQueries,
  invalidateRepoMetadataQueries,
  invalidateRepoWorktreeStatusQueries,
  disposeRepoRuntimeReadState,
  ensureRepoSnapshotReadModel,
  fetchQueryOwnedRepoPullRequestsReadModel,
  fetchQueryOwnedRepoSnapshotReadModel,
  refreshActiveRepoPullRequestQueries,
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

  test('keeps a query-owned pull-request read across an observer replacement', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = Promise.withResolvers<RepoPullRequestsResponse>()
    repoClientMocks.getRepoPullRequests.mockReturnValue(read.promise)
    const options = repoPullRequestsReadModelQueryOptions(
      WORKSPACE_ID,
      'repo-runtime-1',
      { kind: 'branch-detail', branch: 'main' },
      true,
    )
    const firstObserver = new QueryObserver(client, options)
    const unsubscribeFirst = firstObserver.subscribe(() => {})
    await vi.waitFor(() => expect(repoClientMocks.getRepoPullRequests).toHaveBeenCalledOnce())

    unsubscribeFirst()
    const replacementObserver = new QueryObserver(client, options)
    const unsubscribeReplacement = replacementObserver.subscribe(() => {})
    expect(repoClientMocks.getRepoPullRequests).toHaveBeenCalledOnce()

    read.resolve({ pullRequests: null })
    await vi.waitFor(() => expect(replacementObserver.getCurrentResult().data).toEqual({ pullRequests: null }))
    expect(repoClientMocks.getRepoPullRequests).toHaveBeenCalledOnce()
    unsubscribeReplacement()
  })

  test('serializes overlapping active pull-request refreshes and commits the latest version', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scope = { kind: 'branch-detail' as const, branch: 'main' }
    const key = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', scope)
    const reads: Array<PromiseWithResolvers<RepoPullRequestsResponse>> = []
    let activeReads = 0
    let maximumActiveReads = 0
    repoClientMocks.getRepoPullRequests.mockImplementation(() => {
      const read = Promise.withResolvers<RepoPullRequestsResponse>()
      reads.push(read)
      activeReads += 1
      maximumActiveReads = Math.max(maximumActiveReads, activeReads)
      return read.promise.finally(() => {
        activeReads -= 1
      })
    })
    client.setQueryData(key, { pullRequests: null })
    const observer = new QueryObserver(
      client,
      repoPullRequestsReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1', scope, true),
    )
    const unsubscribe = observer.subscribe(() => {})

    const firstRefresh = refreshActiveRepoPullRequestQueries(WORKSPACE_ID, 'repo-runtime-1', {
      queryClient: client,
    })
    await vi.waitFor(() => expect(reads).toHaveLength(1))
    const secondRefresh = refreshActiveRepoPullRequestQueries(WORKSPACE_ID, 'repo-runtime-1', {
      queryClient: client,
    })

    await Promise.resolve()
    expect(reads).toHaveLength(1)
    expect(maximumActiveReads).toBe(1)

    reads[0]!.resolve({ pullRequests: null })
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    expect(maximumActiveReads).toBe(1)
    reads[1]!.resolve({ pullRequests: [] })

    await expect(Promise.all([firstRefresh, secondRefresh])).resolves.toEqual([undefined, undefined])
    expect(client.getQueryData(key)).toEqual({ pullRequests: [] })
    expect(maximumActiveReads).toBe(1)
    unsubscribe()
  })

  test('does not retry an ordinary pull-request transport failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scope = { kind: 'branch-detail' as const, branch: 'main' }
    const key = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', scope)
    const failure = new Error('pull-request transport unavailable')
    repoClientMocks.getRepoPullRequests.mockRejectedValue(failure)
    client.setQueryData(key, { pullRequests: null })
    const observer = new QueryObserver(
      client,
      repoPullRequestsReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1', scope, true),
    )
    const unsubscribe = observer.subscribe(() => {})

    await refreshActiveRepoPullRequestQueries(WORKSPACE_ID, 'repo-runtime-1', { queryClient: client })

    expect(repoClientMocks.getRepoPullRequests).toHaveBeenCalledOnce()
    expect(client.getQueryState(key)?.error).toBe(failure)
    unsubscribe()
  })

  test('keeps an operations read across a StrictMode-style observer replacement', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const reads: Array<PromiseWithResolvers<RepoOperationsSnapshot>> = []
    let aborts = 0
    repoClientMocks.getRepoOperations.mockImplementation((_repoId, _runtimeId, options: { signal?: AbortSignal }) => {
      const read = Promise.withResolvers<RepoOperationsSnapshot>()
      reads.push(read)
      options.signal?.addEventListener('abort', () => {
        aborts += 1
        read.reject(options.signal?.reason)
      })
      return read.promise
    })
    const options = repoOperationsReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1')
    const firstObserver = new QueryObserver(client, options)
    const unsubscribeFirst = firstObserver.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))

    unsubscribeFirst()
    const replacementObserver = new QueryObserver(client, options)
    const unsubscribeReplacement = replacementObserver.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))
    reads[0]!.resolve(repoOperationsForTest(1))

    await vi.waitFor(() => expect(replacementObserver.getCurrentResult().status).toBe('success'))
    expect(aborts).toBe(0)
    unsubscribeReplacement()
  })

  test('keeps a worktree status read across a StrictMode-style observer replacement', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const reads: Array<PromiseWithResolvers<RepoWorktreeStatusSnapshot>> = []
    let aborts = 0
    repoClientMocks.getRepoWorktreeStatus.mockImplementation((_repoId, _runtimeId, signal?: AbortSignal) => {
      const read = Promise.withResolvers<RepoWorktreeStatusSnapshot>()
      reads.push(read)
      signal?.addEventListener('abort', () => {
        aborts += 1
        read.reject(signal?.reason)
      })
      return read.promise
    })
    const options = repoWorktreeStatusReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1', true)
    const firstObserver = new QueryObserver(client, options)
    const unsubscribeFirst = firstObserver.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))

    unsubscribeFirst()
    const replacementObserver = new QueryObserver(client, options)
    const unsubscribeReplacement = replacementObserver.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))
    reads[0]!.resolve({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })

    await vi.waitFor(() => expect(replacementObserver.getCurrentResult().status).toBe('success'))
    expect(aborts).toBe(0)
    unsubscribeReplacement()
  })

  test('disposes runtime read generations with the runtime query scope', async () => {
    const client = new QueryClient()
    const read = Promise.withResolvers<RepoSnapshotResponse>()
    repoClientMocks.getRepoSnapshot.mockReturnValue(read.promise)
    const pending = fetchQueryOwnedRepoSnapshotReadModel(WORKSPACE_ID, 'repo-runtime-disposed', client)
    invalidateRepoMetadataQueries(WORKSPACE_ID, 'repo-runtime-disposed', client)
    disposeRepoRuntimeReadState(WORKSPACE_ID, 'repo-runtime-disposed', client)
    read.resolve(snapshot('disposed'))

    await expect(pending).resolves.toEqual(snapshot('disposed'))
  })

  test('disposes pull-request freshness with the runtime query scope', async () => {
    const client = new QueryClient()
    const read = Promise.withResolvers<RepoPullRequestsResponse>()
    const scope = { kind: 'branch-detail' as const, branch: 'main' }
    repoClientMocks.getRepoPullRequests.mockReturnValue(read.promise)
    const pending = fetchQueryOwnedRepoPullRequestsReadModel(WORKSPACE_ID, 'repo-runtime-disposed', scope, client)
    await refreshActiveRepoPullRequestQueries(WORKSPACE_ID, 'repo-runtime-disposed', { queryClient: client })
    disposeRepoRuntimeReadState(WORKSPACE_ID, 'repo-runtime-disposed', client)
    read.resolve({ pullRequests: null })

    await expect(pending).resolves.toEqual({ pullRequests: null })
  })

  test('keeps snapshot, status, PR, and operations invalidation domains independent', async () => {
    const client = new QueryClient()
    const snapshotKey = repoSnapshotQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const statusKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const prKey = repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', { kind: 'repository-summary' })
    const activeOperationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const settledOperationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1', true)
    client.setQueryData(snapshotKey, snapshot('main'))
    client.setQueryData(statusKey, { workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    client.setQueryData(prKey, { pullRequests: [] })
    client.setQueryData(activeOperationsKey, repoOperationsForTest(1))
    client.setQueryData(settledOperationsKey, repoOperationsForTest(2))

    expect(client.getQueryData(activeOperationsKey)).toEqual(repoOperationsForTest(1))
    expect(client.getQueryData(settledOperationsKey)).toEqual(repoOperationsForTest(2))

    invalidateRepoMetadataQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    await Promise.resolve()
    expect(client.getQueryState(snapshotKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(statusKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(prKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(activeOperationsKey)?.isInvalidated).toBe(false)
    expect(client.getQueryState(settledOperationsKey)?.isInvalidated).toBe(false)

    invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    await Promise.resolve()
    expect(client.getQueryState(statusKey)?.isInvalidated).toBe(true)

    invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', client)
    await Promise.resolve()
    expect(client.getQueryState(activeOperationsKey)?.isInvalidated).toBe(true)
    expect(client.getQueryState(settledOperationsKey)?.isInvalidated).toBe(true)
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

  test('keeps an imperative initial snapshot read across StrictMode-style observer replacement', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = Promise.withResolvers<RepoSnapshotResponse>()
    let aborts = 0
    repoClientMocks.getRepoSnapshot.mockImplementation((_repoId, _runtimeId, signal) => {
      signal?.addEventListener('abort', () => {
        aborts += 1
      })
      return read.promise
    })

    const initialLoad = ensureRepoSnapshotReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient: client })
    await vi.waitFor(() => expect(repoClientMocks.getRepoSnapshot).toHaveBeenCalledOnce())
    const options = repoSnapshotReadModelQueryOptions(WORKSPACE_ID, 'repo-runtime-1', true)
    const firstObserver = new QueryObserver(client, options)
    const unsubscribeFirst = firstObserver.subscribe(() => {})
    unsubscribeFirst()
    const replacementObserver = new QueryObserver(client, options)
    const unsubscribeReplacement = replacementObserver.subscribe(() => {})

    read.resolve(snapshot('main'))

    await expect(initialLoad).resolves.toEqual(snapshot('main'))
    await vi.waitFor(() => expect(replacementObserver.getCurrentResult().data).toEqual(snapshot('main')))
    expect(repoClientMocks.getRepoSnapshot).toHaveBeenCalledOnce()
    expect(aborts).toBe(0)
    unsubscribeReplacement()
  })

  test('caller cancellation stops waiting without aborting the query-owned snapshot read', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const read = Promise.withResolvers<RepoSnapshotResponse>()
    repoClientMocks.getRepoSnapshot.mockReturnValue(read.promise)
    const controller = new AbortController()
    const refresh = refreshRepoSnapshotReadModel(WORKSPACE_ID, 'repo-runtime-1', {
      queryClient: client,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(repoClientMocks.getRepoSnapshot).toHaveBeenCalledOnce())
    controller.abort(new Error('caller cancelled'))
    await expect(refresh).rejects.toThrow('caller cancelled')
    expect(repoClientMocks.getRepoSnapshot).toHaveBeenCalledWith(WORKSPACE_ID, 'repo-runtime-1')
    read.resolve(snapshot('main'))
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
