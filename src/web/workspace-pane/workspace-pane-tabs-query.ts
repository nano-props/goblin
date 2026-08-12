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
import { appQueryClient } from '#/web/app-query-client.ts'
import { defaultWorkspacePaneTabs, normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { goblinLog } from '#/web/logger.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'

export type WorkspacePaneTabsQueryData = WorkspacePaneTabsSnapshot
export type WorkspacePaneTabsProjectionPhase = 'pending' | 'ready' | 'failed'

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
  return {
    queryKey: workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId),
    queryFn: async () => await fetchWorkspacePaneTabsSnapshot(workspaceId, workspaceRuntimeId),
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
  const snapshot = queryClient.getQueryData<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(target.workspaceId, target.workspaceRuntimeId),
  )
  return workspacePaneTabsForTargetFromQueryData(snapshot ?? emptyWorkspacePaneTabsSnapshot(), target)
}

export function readWorkspacePaneTabsProjectionForTarget(
  target: WorkspacePaneTabsReadTarget & { workspaceRuntimeId: string },
  queryClient: QueryClient = appQueryClient,
): WorkspacePaneTabsTargetProjection {
  const state = queryClient.getQueryState<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(target.workspaceId, target.workspaceRuntimeId),
  )
  if (state?.status === 'error') return { phase: 'failed', tabs: [] }
  if (state?.status !== 'success') return { phase: 'pending', tabs: [] }
  return {
    phase: 'ready',
    tabs: workspacePaneTabsForTargetFromQueryData(state.data ?? emptyWorkspacePaneTabsSnapshot(), target),
  }
}

export function workspacePaneTabsForTargetFromQueryData(
  data: WorkspacePaneTabsSnapshot,
  target: WorkspacePaneTabsReadTarget,
): WorkspacePaneTabEntry[] {
  const resolvedTarget = target.kind === 'inactive' ? null : target
  if (!resolvedTarget) return []
  const entry = workspacePaneTabsEntryForTarget(data.entries, resolvedTarget)
  return [...(entry?.tabs ?? defaultWorkspacePaneTabs())]
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
  let accepted = false
  queryClient.setQueryData<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(workspaceId, workspaceRuntimeId),
    (current) => {
      const next = acceptedWorkspacePaneTabsSnapshot(current, snapshot)
      accepted = next !== current
      return next
    },
  )
  if (accepted) notifyWorkspacePaneTabsPersistenceChanged()
  return accepted
}

export function refreshWorkspacePaneTabs(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = appQueryClient,
): void {
  void refreshWorkspacePaneTabsQueryData(workspaceId, workspaceRuntimeId, queryClient).catch((err) => {
    goblinLog.warn('workspace pane tabs refresh failed', { workspaceId, workspaceRuntimeId, err })
  })
}

export async function refreshWorkspacePaneTabsQueryData(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  queryClient: QueryClient = appQueryClient,
): Promise<void> {
  const snapshot = await fetchWorkspacePaneTabsSnapshot(workspaceId, workspaceRuntimeId)
  writeWorkspacePaneTabsSnapshotQueryData(workspaceId, workspaceRuntimeId, snapshot, queryClient)
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

function emptyWorkspacePaneTabsSnapshot(): WorkspacePaneTabsSnapshot {
  return { revision: 0, entries: [] }
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
