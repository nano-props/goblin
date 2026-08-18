import { computed, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { QueryClient } from '@tanstack/query-core'
import { useQuery } from '@tanstack/vue-query'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { isWorkspacePaneRuntimeTabEntry, type WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  type WorkspacePaneTabsTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { defaultWorkspacePaneTabs, normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { goblinLog } from '#/web/logger.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'

export type WorkspacePaneTabsQueryData = WorkspacePaneTabsSnapshot
export type WorkspacePaneTabsProjectionPhase = 'pending' | 'ready' | 'failed'
export type WorkspacePaneTabsRecoveryRequirement = { kind: 'fresh' } | { kind: 'minimum-revision'; revision: number }

export interface WorkspacePaneTabsTargetProjection {
  phase: WorkspacePaneTabsProjectionPhase
  tabs: WorkspacePaneTabEntry[]
}

type WorkspacePaneTabsReadTarget =
  WorkspacePaneTabsTarget | { kind: 'inactive'; workspaceId: WorkspaceId; branchName: null; worktreePath: null }

let workspacePaneTabsPersistenceVersion = 0
const workspacePaneTabsPersistenceListeners = new Set<() => void>()

export function workspacePaneTabsQueryKey(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  return ['workspace-pane-tabs', workspaceId, workspaceRuntimeId] as const
}

export function workspacePaneTabsQueryOptions(workspaceId: WorkspaceId, workspaceRuntimeId: string) {
  const queryKey = workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId)
  return {
    queryKey,
    queryFn: async ({ client }: { client: QueryClient }) =>
      await fetchWorkspacePaneTabsSnapshotForQuery(workspaceId, workspaceRuntimeId, client),
    structuralSharing: (oldData: unknown, newData: unknown) =>
      acceptedWorkspacePaneTabsSnapshot(
        oldData as WorkspacePaneTabsSnapshot | undefined,
        newData as WorkspacePaneTabsSnapshot,
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  }
}

export function useWorkspacePaneTabsQuery(
  workspaceId: MaybeRefOrGetter<WorkspaceId>,
  workspaceRuntimeId: MaybeRefOrGetter<string>,
  options: { enabled?: MaybeRefOrGetter<boolean | undefined> } = {},
) {
  const query = useQuery(
    computed(() => ({
      ...workspacePaneTabsQueryOptions(toValue(workspaceId), toValue(workspaceRuntimeId)),
      enabled: toValue(options.enabled) !== false,
    })),
  )
  // The persistence projection is an external subscriber boundary: publish
  // after TanStack Query has accepted a successful snapshot, including cache hydration.
  watch(
    [query.status, query.dataUpdatedAt],
    ([status]) => {
      if (status === 'success') notifyWorkspacePaneTabsPersistenceChanged()
    },
    { immediate: true },
  )
  return query
}

export function readWorkspacePaneTabsForTarget(
  target: WorkspacePaneTabsReadTarget & { workspaceRuntimeId: string },
  queryClient: QueryClient = appQueryClient,
): WorkspacePaneTabEntry[] {
  return readWorkspacePaneTabsProjectionForTarget(target, queryClient).tabs
}

export function readWorkspacePaneTabsProjectionForTarget(
  target: WorkspacePaneTabsReadTarget & { workspaceRuntimeId: string },
  queryClient: QueryClient = appQueryClient,
): WorkspacePaneTabsTargetProjection {
  const state = queryClient.getQueryState<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(target.workspaceId, target.workspaceRuntimeId),
  )
  const phase = state?.status === 'success' ? 'ready' : state?.status === 'error' ? 'failed' : 'pending'
  return projectWorkspacePaneTabsForTarget(state?.data, phase, target)
}

export function projectWorkspacePaneTabsForTarget(
  data: WorkspacePaneTabsSnapshot | undefined,
  phase: WorkspacePaneTabsProjectionPhase,
  target: WorkspacePaneTabsReadTarget,
): WorkspacePaneTabsTargetProjection {
  if (target.kind === 'inactive' || !data) return { phase, tabs: [] }
  const entry = workspacePaneTabsEntryForTarget(data.entries, target)
  if (entry) return { phase, tabs: [...entry.tabs] }
  return { phase, tabs: defaultWorkspacePaneTabs() }
}

/** Projects a complete successful snapshot; an absent target receives the protocol defaults. */
export function workspacePaneTabsForTargetFromSnapshot(
  data: WorkspacePaneTabsSnapshot,
  target: WorkspacePaneTabsReadTarget,
): WorkspacePaneTabEntry[] {
  return projectWorkspacePaneTabsForTarget(data, 'ready', target).tabs
}

/**
 * Applies a full server snapshot iff its revision is at least the cached
 * revision. Returns whether the snapshot was accepted.
 */
export function writeWorkspacePaneTabsSnapshotQueryData(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  snapshot: WorkspacePaneTabsSnapshot | null,
  queryClient: QueryClient = appQueryClient,
): boolean {
  if (!snapshot) return false
  const queryKey = workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId)
  const current = queryClient.getQueryData<WorkspacePaneTabsQueryData>(queryKey)
  const next = acceptedWorkspacePaneTabsSnapshot(current, snapshot)
  if (next === current) return false

  queryClient.setQueryData<WorkspacePaneTabsQueryData>(queryKey, next)
  notifyWorkspacePaneTabsPersistenceChanged()
  return true
}

export function refreshWorkspacePaneTabs(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = appQueryClient,
): void {
  void refreshWorkspacePaneTabsQueryData(workspaceId, workspaceRuntimeId, { queryClient }).catch((err) => {
    goblinLog.warn('workspace pane tabs refresh failed', { workspaceId, workspaceRuntimeId, err })
  })
}

export async function refreshWorkspacePaneTabsQueryData(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  options: { queryClient?: QueryClient; requirement?: WorkspacePaneTabsRecoveryRequirement } = {},
): Promise<void> {
  const queryClient: QueryClient = options.queryClient ?? appQueryClient
  const queryOptions = workspacePaneTabsQueryOptions(workspaceId, workspaceRuntimeId)
  const joinedExistingRequest =
    queryClient.getQueryState<WorkspacePaneTabsQueryData>(queryOptions.queryKey)?.fetchStatus === 'fetching'
  const joinedError = await queryClient
    .fetchQuery({
      ...queryOptions,
      staleTime: 0,
    })
    .then(
      () => null,
      (error: unknown) => error,
    )
  if (joinedError && !joinedExistingRequest) throw joinedError

  const requirement = options.requirement
  if (!requirement) return
  if (
    requirement.kind === 'minimum-revision' &&
    workspacePaneTabsQueryRevision(queryClient, queryOptions.queryKey) >= requirement.revision
  ) {
    return
  }
  if (requirement.kind === 'fresh' && !joinedExistingRequest) return

  // A recovery may join a request that started before its trigger. Once that
  // request settles, perform one post-trigger read. A revision watermark also
  // gets one fresh read when the joined snapshot cannot satisfy it. Failure at
  // this boundary is final; callers surface it instead of polling.
  await queryClient.fetchQuery({
    ...queryOptions,
    queryFn:
      requirement.kind === 'minimum-revision'
        ? async ({ client }: { client: QueryClient }) => {
            const snapshot = await fetchWorkspacePaneTabsSnapshotForQuery(workspaceId, workspaceRuntimeId, client)
            const acceptedRevision = Math.max(
              snapshot.revision,
              workspacePaneTabsQueryRevision(client, queryOptions.queryKey),
            )
            if (acceptedRevision < requirement.revision) {
              throw new Error(
                `Workspace pane tabs recovery did not reach required revision ${requirement.revision}; received ${acceptedRevision}`,
              )
            }
            return snapshot
          }
        : queryOptions.queryFn,
    staleTime: 0,
  })
}

export function clearWorkspacePaneTabsProjectionState(workspaceId: WorkspaceId, workspaceRuntimeId: string): void {
  appQueryClient.removeQueries({
    queryKey: workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId),
    exact: true,
  })
}

export function workspacePaneTabsByTargetFromQueryData(
  data: WorkspacePaneTabsSnapshot,
): Record<string, WorkspacePaneTabEntry[]> {
  const byTarget: Record<string, WorkspacePaneTabEntry[]> = {}
  for (const entry of data.entries) {
    const target = workspacePaneTabsTargetFromRuntime(entry.target)
    if (!target) continue
    byTarget[workspacePaneTabsTargetIdentityKey(target)] = normalizeWorkspacePaneTabs(
      entry.tabs.filter((tab) => !isWorkspacePaneRuntimeTabEntry(tab)),
      { hasWorktree: workspacePaneTargetHasExecutionRoot(target) },
    )
  }
  return byTarget
}

export function subscribeWorkspacePaneTabsPersistenceChanges(onStoreChange: () => void): () => void {
  workspacePaneTabsPersistenceListeners.add(onStoreChange)
  return () => {
    workspacePaneTabsPersistenceListeners.delete(onStoreChange)
  }
}

export function workspacePaneTabsPersistenceSnapshot(): number {
  return workspacePaneTabsPersistenceVersion
}

export function workspacePaneTabsProjectionRevision(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): number | null {
  return (
    appQueryClient.getQueryData<WorkspacePaneTabsSnapshot>(workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId))
      ?.revision ?? null
  )
}

function notifyWorkspacePaneTabsPersistenceChanged(): void {
  workspacePaneTabsPersistenceVersion += 1
  for (const listener of workspacePaneTabsPersistenceListeners) listener()
}

async function fetchWorkspacePaneTabsSnapshot(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): Promise<WorkspacePaneTabsSnapshot> {
  return normalizeWorkspacePaneTabsSnapshot(
    await workspacePaneTabsClient.list({ workspaceId: workspaceId, workspaceRuntimeId: workspaceRuntimeId }),
  )
}

async function fetchWorkspacePaneTabsSnapshotForQuery(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient,
): Promise<WorkspacePaneTabsSnapshot> {
  const queryKey = workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId)
  const dataUpdateCount = queryClient.getQueryState<WorkspacePaneTabsQueryData>(queryKey)?.dataUpdateCount ?? 0
  try {
    return await fetchWorkspacePaneTabsSnapshot(workspaceId, workspaceRuntimeId)
  } catch (error) {
    const current = queryClient.getQueryState<WorkspacePaneTabsQueryData>(queryKey)
    // A full authoritative snapshot committed after this read began makes its
    // failure stale; the cache already contains the newer projection.
    if (current?.data !== undefined && current.dataUpdateCount !== dataUpdateCount) return current.data
    throw error
  }
}

function workspacePaneTabsQueryRevision(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof workspacePaneTabsQueryKey>,
): number {
  return queryClient.getQueryData<WorkspacePaneTabsQueryData>(queryKey)?.revision ?? -1
}

/** The single revision acceptance rule for every server-snapshot cache entry. */
function acceptedWorkspacePaneTabsSnapshot(
  current: WorkspacePaneTabsSnapshot | undefined,
  incoming: WorkspacePaneTabsSnapshot,
): WorkspacePaneTabsSnapshot {
  const normalized = normalizeWorkspacePaneTabsSnapshot(incoming)
  return current && normalized.revision < current.revision ? current : normalized
}

function normalizeWorkspacePaneTabsSnapshot(snapshot: WorkspacePaneTabsSnapshot): WorkspacePaneTabsSnapshot {
  return {
    revision: snapshot.revision,
    entries: normalizeWorkspacePaneTabsQueryEntries(snapshot.entries),
  }
}

function normalizeWorkspacePaneTabsQueryEntries(entries: readonly WorkspacePaneTabsEntry[]): WorkspacePaneTabsEntry[] {
  const byTarget = new Map<string, WorkspacePaneTabsEntry>()
  for (const entry of entries) {
    const target = workspacePaneTabsTargetFromRuntime(entry.target)
    if (!target || (target.kind === 'git-branch' && target.branchName.includes('\0'))) continue
    byTarget.set(workspacePaneTabsTargetIdentityKey(target), {
      target: entry.target,
      tabs: normalizeWorkspacePaneTabs(entry.tabs, {
        hasWorktree: workspacePaneTargetHasExecutionRoot(target),
      }),
    })
  }
  return Array.from(byTarget.values())
}

function workspacePaneTargetHasExecutionRoot(target: WorkspacePaneTabsTarget): boolean {
  return target.kind !== 'git-branch'
}

function workspacePaneTabsEntryForTarget(
  entries: readonly WorkspacePaneTabsEntry[],
  target: WorkspacePaneTabsTarget,
): WorkspacePaneTabsEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const runtimeEntryTarget = entry ? workspacePaneTabsTargetFromRuntime(entry.target) : null
    if (
      entry &&
      runtimeEntryTarget &&
      workspacePaneTabsTargetIdentityKey(runtimeEntryTarget) === workspacePaneTabsTargetIdentityKey(target)
    )
      return entry
  }
  return undefined
}
