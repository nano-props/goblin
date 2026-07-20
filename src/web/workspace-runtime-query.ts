import { queryOptions, type QueryClient } from '@tanstack/react-query'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { WorkspaceRuntimeEntry, WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { listWorkspaceRuntimes } from '#/web/workspace-client.ts'

type WorkspaceRuntimeCachePatch = Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId'> &
  Partial<WorkspaceRuntimeEntry>

interface WorkspaceRuntimeRefreshState {
  running: Promise<WorkspaceRuntimesSnapshot> | null
  trailing: boolean
}

const refreshStates = new WeakMap<QueryClient, WorkspaceRuntimeRefreshState>()

async function waitForWorkspaceRuntimeRefresh(queryClient: QueryClient): Promise<void> {
  const running = refreshStates.get(queryClient)?.running
  if (!running) return
  // A membership response remains authoritative even when the older read
  // failed, so only use that read as an ordering barrier.
  await running.catch(() => undefined)
}

export function workspaceRuntimesQueryKey() {
  return ['workspace-runtime', 'runtimes'] as const
}

export function workspaceRuntimesQueryOptions() {
  return queryOptions({
    queryKey: workspaceRuntimesQueryKey(),
    queryFn: ({ signal }) => listWorkspaceRuntimes(signal),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export async function refreshWorkspaceRuntimes(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<WorkspaceRuntimesSnapshot> {
  return await requestWorkspaceRuntimeRefresh(queryClient, false)
}

async function requestWorkspaceRuntimeRefresh(
  queryClient: QueryClient,
  requestTrailingRefresh: boolean,
): Promise<WorkspaceRuntimesSnapshot> {
  let state = refreshStates.get(queryClient)
  if (!state) {
    state = { running: null, trailing: false }
    refreshStates.set(queryClient, state)
  }
  if (state.running) {
    if (requestTrailingRefresh) state.trailing = true
    return await state.running
  }
  const running = (async () => {
    let snapshot: WorkspaceRuntimesSnapshot | undefined
    do {
      state.trailing = false
      await queryClient.invalidateQueries({ queryKey: workspaceRuntimesQueryKey(), exact: true, refetchType: 'none' })
      try {
        snapshot = await queryClient.fetchQuery(workspaceRuntimesQueryOptions())
      } catch (error) {
        if (!state.trailing) throw error
        continue
      }
    } while (state.trailing)
    if (!snapshot) throw new Error('workspace runtime refresh completed without a snapshot')
    return snapshot
  })()
  state.running = running
  try {
    return await running
  } finally {
    if (state.running === running) state.running = null
  }
}

export async function updateWorkspaceRuntimeCache(
  entry: WorkspaceRuntimeCachePatch,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await waitForWorkspaceRuntimeRefresh(queryClient)
  queryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), (current) => {
    const existing = current?.runtimes ?? []
    const previous = existing.find((item) => item.workspaceId === entry.workspaceId)
    const runtimes = existing.filter((item) => item.workspaceId !== entry.workspaceId)
    runtimes.push({ workspaceProbe: { status: 'probing' }, ...previous, ...entry })
    return { runtimes }
  })
}

export async function removeWorkspaceRuntimeFromCache(
  entry: Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId'>,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await waitForWorkspaceRuntimeRefresh(queryClient)
  let foundMatchingEntry = false
  queryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), (current) => {
    if (!current) return current
    const runtimes = current.runtimes.filter((item) => {
      const matches = item.workspaceId === entry.workspaceId && item.workspaceRuntimeId === entry.workspaceRuntimeId
      if (matches) foundMatchingEntry = true
      return !matches
    })
    return runtimes.length === current.runtimes.length ? current : { runtimes }
  })
  if (!foundMatchingEntry) {
    await refreshWorkspaceRuntimes(queryClient)
  }
}

export async function invalidateWorkspaceRuntimes(
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<WorkspaceRuntimesSnapshot> {
  return await requestWorkspaceRuntimeRefresh(queryClient, true)
}
