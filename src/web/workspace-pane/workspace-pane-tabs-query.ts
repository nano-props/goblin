import { useEffect } from 'react'
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import {
  type WorkspacePaneTabsTarget,
  workspacePaneTabsEntryMatchesTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { defaultWorkspacePaneTabs, normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { gblLog } from '#/web/logger.ts'
import { workspacePaneTabsClient } from '#/web/workspace-pane/workspace-pane-tabs-client.ts'

export type WorkspacePaneTabsQueryData = WorkspacePaneTabsEntry[]

let workspacePaneTabsPersistenceVersion = 0
const workspacePaneTabsPersistenceListeners = new Set<() => void>()
const workspacePaneTabsProjectionGeneration = new Map<string, number>()
const workspacePaneTabsTargetGeneration = new Map<string, number>()
const workspacePaneTabsRefreshSequence = new Map<string, number>()
let workspacePaneTabsNextRefreshSequence = 0

export function workspacePaneTabsQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['workspace-pane-tabs', repoRoot, repoInstanceId] as const
}

export function workspacePaneTabsQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: workspacePaneTabsQueryKey(repoRoot, repoInstanceId),
    queryFn: async () => fetchWorkspacePaneTabsQueryData(repoRoot, repoInstanceId),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export function useWorkspacePaneTabsQuery(repoRoot: string, repoInstanceId: string) {
  const query = useQuery(workspacePaneTabsQueryOptions(repoRoot, repoInstanceId))
  useEffect(() => {
    if (query.status === 'success') notifyWorkspacePaneTabsPersistenceChanged()
  }, [query.dataUpdatedAt, query.status])
  return query
}

export function readWorkspacePaneTabsForTarget(
  target: {
    repoRoot: string
    repoInstanceId: string
    branchName: string | null | undefined
    worktreePath: string | null
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): WorkspacePaneTabEntry[] {
  const data =
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(
      workspacePaneTabsQueryKey(target.repoRoot, target.repoInstanceId),
    ) ?? []
  return workspacePaneTabsForTargetFromQueryData(data, target)
}

export function workspacePaneTabsForTargetFromQueryData(
  data: readonly WorkspacePaneTabsEntry[],
  target: {
    repoRoot: string
    branchName: string | null | undefined
    worktreePath: string | null
  },
): WorkspacePaneTabEntry[] {
  if (!target.branchName) return []
  const entry = workspacePaneTabsEntryForTarget(data, {
    repoRoot: target.repoRoot,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
  })
  return [...(entry?.tabs ?? defaultWorkspacePaneTabs())]
}

export function setWorkspacePaneTabsForTargetQueryData(
  input: {
    repoRoot: string
    repoInstanceId: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  updateWorkspacePaneTabsQueryData(input.repoRoot, input.repoInstanceId, queryClient, (current) => [
    ...(current ?? []).filter((entry) => !workspacePaneTabsEntryMatchesTarget(entry, input)),
    {
      repoRoot: input.repoRoot,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      tabs: [...input.tabs],
    },
  ])
  bumpWorkspacePaneTabsTargetVersion(input)
}

export function replaceWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  entries: readonly WorkspacePaneTabsEntry[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const currentEntries =
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot, repoInstanceId)) ?? []
  updateWorkspacePaneTabsQueryData(repoRoot, repoInstanceId, queryClient, () => entries)
  bumpWorkspacePaneTabsTargetVersions(repoRoot, repoInstanceId, [...currentEntries, ...entries])
}

export function restoreWorkspacePaneTabsTargetQueryData(
  input: {
    repoRoot: string
    repoInstanceId: string
    branchName: string
    worktreePath: string | null
    previousTargetEntry: WorkspacePaneTabsEntry | undefined
    expectedTargetVersion?: number
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): boolean {
  if (
    input.expectedTargetVersion !== undefined &&
    workspacePaneTabsTargetVersion(input) !== input.expectedTargetVersion
  ) {
    return false
  }
  updateWorkspacePaneTabsQueryData(input.repoRoot, input.repoInstanceId, queryClient, (current) => [
    ...(current ?? []).filter((entry) => !workspacePaneTabsEntryMatchesTarget(entry, input)),
    ...(input.previousTargetEntry ? [input.previousTargetEntry] : []),
  ])
  bumpWorkspacePaneTabsTargetVersion(input)
  return true
}

export async function cancelWorkspacePaneTabs(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot, repoInstanceId), exact: true })
}

export function refreshWorkspacePaneTabs(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  void refreshWorkspacePaneTabsQueryData(repoRoot, repoInstanceId, queryClient).catch((err) => {
    gblLog.warn('workspace pane tabs refresh failed', { repoRoot, repoInstanceId, err })
  })
}

export async function refreshWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  const key = workspacePaneTabsProjectionKey(repoRoot, repoInstanceId)
  const requestId = nextWorkspacePaneTabsRefreshSequence(key)
  const startedGeneration = workspacePaneTabsProjectionGeneration.get(key) ?? 0
  await queryClient.cancelQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot, repoInstanceId), exact: true })
  const entries = await fetchWorkspacePaneTabsQueryData(repoRoot, repoInstanceId)
  if (!isCurrentWorkspacePaneTabsRefresh(key, requestId, startedGeneration)) return
  replaceWorkspacePaneTabsQueryData(repoRoot, repoInstanceId, entries, queryClient)
}

export function clearWorkspacePaneTabsProjectionState(repoRoot: string, repoInstanceId: string): void {
  const key = workspacePaneTabsProjectionKey(repoRoot, repoInstanceId)
  workspacePaneTabsProjectionGeneration.delete(key)
  workspacePaneTabsRefreshSequence.delete(key)
  clearWorkspacePaneTabsTargetVersions(key)
}

export function workspacePaneTabsTargetVersion(input: {
  repoRoot: string
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
}): number {
  return workspacePaneTabsTargetGeneration.get(workspacePaneTabsTargetProjectionKey(input)) ?? 0
}

export function workspacePaneTabsByTargetFromQueryData(
  data: readonly WorkspacePaneTabsEntry[],
): Record<string, WorkspacePaneTabEntry[]> {
  const byTarget: Record<string, WorkspacePaneTabEntry[]> = {}
  for (const entry of data) {
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

function workspacePaneTabsProjectionKey(repoRoot: string, repoInstanceId: string): string {
  return `${repoRoot}\0${repoInstanceId}`
}

function workspacePaneTabsTargetProjectionKey(input: {
  repoRoot: string
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
}): string {
  return `${workspacePaneTabsProjectionKey(input.repoRoot, input.repoInstanceId)}\0${workspacePaneTabsTargetIdentityKey(
    input,
  )}`
}

function bumpWorkspacePaneTabsTargetVersion(input: {
  repoRoot: string
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
}): void {
  const key = workspacePaneTabsTargetProjectionKey(input)
  workspacePaneTabsTargetGeneration.set(key, (workspacePaneTabsTargetGeneration.get(key) ?? 0) + 1)
}

function bumpWorkspacePaneTabsTargetVersions(
  repoRoot: string,
  repoInstanceId: string,
  targets: readonly WorkspacePaneTabsEntry[],
): void {
  const targetKeys = new Set<string>()
  for (const target of targets) {
    targetKeys.add(
      workspacePaneTabsTargetProjectionKey({
        repoRoot,
        repoInstanceId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
      }),
    )
  }
  for (const key of targetKeys) {
    workspacePaneTabsTargetGeneration.set(key, (workspacePaneTabsTargetGeneration.get(key) ?? 0) + 1)
  }
}

function clearWorkspacePaneTabsTargetVersions(projectionKey: string): void {
  const prefix = `${projectionKey}\0`
  for (const key of workspacePaneTabsTargetGeneration.keys()) {
    if (key.startsWith(prefix)) workspacePaneTabsTargetGeneration.delete(key)
  }
}

function nextWorkspacePaneTabsRefreshSequence(key: string): number {
  const next = ++workspacePaneTabsNextRefreshSequence
  workspacePaneTabsRefreshSequence.set(key, next)
  return next
}

function isCurrentWorkspacePaneTabsRefresh(key: string, requestId: number, startedGeneration: number): boolean {
  return (
    workspacePaneTabsRefreshSequence.get(key) === requestId &&
    (workspacePaneTabsProjectionGeneration.get(key) ?? 0) === startedGeneration
  )
}

async function fetchWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoInstanceId: string,
): Promise<WorkspacePaneTabsQueryData> {
  return normalizeWorkspacePaneTabsQueryData(await workspacePaneTabsClient.list({ repoRoot, repoInstanceId }))
}

function updateWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient,
  update: (current: WorkspacePaneTabsQueryData | undefined) => readonly WorkspacePaneTabsEntry[],
): void {
  const key = workspacePaneTabsProjectionKey(repoRoot, repoInstanceId)
  queryClient.setQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot, repoInstanceId), (current) =>
    normalizeWorkspacePaneTabsQueryData(update(current)),
  )
  workspacePaneTabsProjectionGeneration.set(key, (workspacePaneTabsProjectionGeneration.get(key) ?? 0) + 1)
  notifyWorkspacePaneTabsPersistenceChanged()
}

function normalizeWorkspacePaneTabsQueryData(entries: readonly WorkspacePaneTabsEntry[]): WorkspacePaneTabsQueryData {
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

function workspacePaneTabsEntryForTarget(
  data: readonly WorkspacePaneTabsEntry[],
  target: WorkspacePaneTabsTarget,
): WorkspacePaneTabsEntry | undefined {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const entry = data[index]
    if (entry && workspacePaneTabsEntryMatchesTarget(entry, target)) return entry
  }
  return undefined
}
