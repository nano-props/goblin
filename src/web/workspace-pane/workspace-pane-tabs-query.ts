import { useEffect } from 'react'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  type WorkspacePaneTabsTarget,
  workspacePaneTabsEntryMatchesTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { defaultWorkspacePaneTabs, normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { gblLog } from '#/web/logger.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'

export type WorkspacePaneTabsQueryData = WorkspacePaneTabsSnapshot
export type WorkspacePaneTabsProjectionPhase = 'pending' | 'ready' | 'failed'

export interface WorkspacePaneTabsTargetProjection {
  phase: WorkspacePaneTabsProjectionPhase
  tabs: WorkspacePaneTabEntry[]
}

let workspacePaneTabsPersistenceVersion = 0
const workspacePaneTabsPersistenceListeners = new Set<() => void>()

export function workspacePaneTabsQueryKey(repoRoot: string, repoRuntimeId: string) {
  return ['workspace-pane-tabs', repoRoot, repoRuntimeId] as const
}

export function workspacePaneTabsQueryOptions(repoRoot: string, repoRuntimeId: string) {
  return queryOptions({
    queryKey: workspacePaneTabsQueryKey(repoRoot, repoRuntimeId),
    queryFn: async () => await fetchWorkspacePaneTabsSnapshot(repoRoot, repoRuntimeId),
    structuralSharing: (oldData, newData) =>
      acceptedWorkspacePaneTabsSnapshot(
        oldData as WorkspacePaneTabsSnapshot | undefined,
        newData as WorkspacePaneTabsSnapshot,
      ),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export function useWorkspacePaneTabsQuery(
  repoRoot: string,
  repoRuntimeId: string,
  options: { enabled?: boolean } = {},
) {
  const query = useQuery({
    ...workspacePaneTabsQueryOptions(repoRoot, repoRuntimeId),
    enabled: options.enabled !== false,
  })
  useEffect(() => {
    if (query.status === 'success') notifyWorkspacePaneTabsPersistenceChanged()
  }, [query.dataUpdatedAt, query.status])
  return query
}

export function readWorkspacePaneTabsForTarget(
  target: {
    repoRoot: string
    repoRuntimeId: string
    branchName: string | null | undefined
    worktreePath: string | null
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): WorkspacePaneTabEntry[] {
  const snapshot = queryClient.getQueryData<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(target.repoRoot, target.repoRuntimeId),
  )
  return workspacePaneTabsForTargetFromQueryData(snapshot ?? emptyWorkspacePaneTabsSnapshot(), target)
}

export function readWorkspacePaneTabsProjectionForTarget(
  target: {
    repoRoot: string
    repoRuntimeId: string
    branchName: string | null | undefined
    worktreePath: string | null
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): WorkspacePaneTabsTargetProjection {
  const state = queryClient.getQueryState<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(target.repoRoot, target.repoRuntimeId),
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
  target: {
    repoRoot: string
    branchName: string | null | undefined
    worktreePath: string | null
  },
): WorkspacePaneTabEntry[] {
  if (!target.branchName) return []
  const entry = workspacePaneTabsEntryForTarget(data.entries, {
    repoRoot: target.repoRoot,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
  })
  return [...(entry?.tabs ?? defaultWorkspacePaneTabs())]
}

/**
 * Applies a full server snapshot iff its revision is at least the cached
 * revision. Returns whether the snapshot was accepted.
 */
export function writeWorkspacePaneTabsSnapshotQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  snapshot: WorkspacePaneTabsSnapshot,
  queryClient: QueryClient = primaryWindowQueryClient,
): boolean {
  let accepted = false
  queryClient.setQueryData<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(repoRoot, repoRuntimeId),
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
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  void refreshWorkspacePaneTabsQueryData(repoRoot, repoRuntimeId, queryClient).catch((err) => {
    gblLog.warn('workspace pane tabs refresh failed', { repoRoot, repoRuntimeId, err })
  })
}

export async function refreshWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  const snapshot = await fetchWorkspacePaneTabsSnapshot(repoRoot, repoRuntimeId)
  writeWorkspacePaneTabsSnapshotQueryData(repoRoot, repoRuntimeId, snapshot, queryClient)
}

export function clearWorkspacePaneTabsProjectionState(repoRoot: string, repoRuntimeId: string): void {
  primaryWindowQueryClient.removeQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot, repoRuntimeId), exact: true })
}

export function workspacePaneTabsByTargetFromQueryData(
  data: WorkspacePaneTabsSnapshot,
): Record<string, WorkspacePaneTabEntry[]> {
  const byTarget: Record<string, WorkspacePaneTabEntry[]> = {}
  for (const entry of data.entries) {
    byTarget[workspacePaneTabsTargetIdentityKey(entry)] = normalizeWorkspacePaneTabs(entry.tabs, {
      hasWorktree: entry.worktreePath !== null,
    })
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

function notifyWorkspacePaneTabsPersistenceChanged(): void {
  workspacePaneTabsPersistenceVersion += 1
  for (const listener of workspacePaneTabsPersistenceListeners) listener()
}

async function fetchWorkspacePaneTabsSnapshot(
  repoRoot: string,
  repoRuntimeId: string,
): Promise<WorkspacePaneTabsSnapshot> {
  return normalizeWorkspacePaneTabsSnapshot(await workspacePaneTabsClient.list({ repoRoot, repoRuntimeId }))
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
    if (!entry.branchName || entry.branchName.includes('\0')) continue
    byTarget.set(workspacePaneTabsTargetIdentityKey(entry), {
      repoRoot: entry.repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
      tabs: normalizeWorkspacePaneTabs(entry.tabs, { hasWorktree: entry.worktreePath !== null }),
    })
  }
  return Array.from(byTarget.values())
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
    if (entry && workspacePaneTabsEntryMatchesTarget(entry, target)) return entry
  }
  return undefined
}
