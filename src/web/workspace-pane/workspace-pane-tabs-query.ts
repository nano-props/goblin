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
export type WorkspacePaneTabsProjectionPhase = 'pending' | 'ready' | 'failed'

export interface WorkspacePaneTabsTargetProjection {
  phase: WorkspacePaneTabsProjectionPhase
  tabs: WorkspacePaneTabEntry[]
}

interface WorkspacePaneTabsManualRefreshScope {
  projectionKey: string
  requestVersion: number
  startedProjectionVersion: number
}

interface WorkspacePaneTabsVersionTarget {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}

class StaleWorkspacePaneTabsProjectionReadError extends Error {
  constructor() {
    super('Stale workspace pane tabs projection read')
    this.name = 'StaleWorkspacePaneTabsProjectionReadError'
  }
}

let workspacePaneTabsPersistenceVersion = 0
const workspacePaneTabsPersistenceListeners = new Set<() => void>()
const workspacePaneTabsProjectionVersion = new Map<string, number>()
const workspacePaneTabsTargetGeneration = new Map<string, number>()
const workspacePaneTabsTargetWriteGeneration = new Map<string, number>()
const workspacePaneTabsManualRefreshVersion = new Map<string, number>()
// Explicit cache writes accept data before calling setQueryData. React Query can
// still run structuralSharing for that set, so accepted arrays skip bookkeeping.
const acceptedWorkspacePaneTabsQueryData = new WeakSet<WorkspacePaneTabsQueryData>()
let workspacePaneTabsNextProjectionVersion = 0
let workspacePaneTabsNextManualRefreshVersion = 0

export function workspacePaneTabsQueryKey(repoRoot: string, repoRuntimeId: string) {
  return ['workspace-pane-tabs', repoRoot, repoRuntimeId] as const
}

export function workspacePaneTabsQueryOptions(repoRoot: string, repoRuntimeId: string) {
  return queryOptions({
    queryKey: workspacePaneTabsQueryKey(repoRoot, repoRuntimeId),
    queryFn: async () => fetchWorkspacePaneTabsReadModel(repoRoot, repoRuntimeId),
    structuralSharing: (oldData, newData) => {
      if (!Array.isArray(newData)) return newData
      const current = Array.isArray(oldData) ? (oldData as WorkspacePaneTabsQueryData) : undefined
      const next = newData as WorkspacePaneTabsQueryData
      if (acceptedWorkspacePaneTabsQueryData.has(next)) return next
      return acceptWorkspacePaneTabsQueryData(repoRoot, repoRuntimeId, current, next, [
        ...(current ?? []),
        ...next,
      ])
    },
    retry: (_failureCount, err) => isStaleWorkspacePaneTabsProjectionReadError(err),
    retryDelay: 0,
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
  const data =
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(
      workspacePaneTabsQueryKey(target.repoRoot, target.repoRuntimeId),
    ) ?? []
  return workspacePaneTabsForTargetFromQueryData(data, target)
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
  return { phase: 'ready', tabs: workspacePaneTabsForTargetFromQueryData(state.data ?? [], target) }
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
    repoRuntimeId: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  updateWorkspacePaneTabsQueryData(
    input.repoRoot,
    input.repoRuntimeId,
    queryClient,
    (current) => [
      ...(current ?? []).filter((entry) => !workspacePaneTabsEntryMatchesTarget(entry, input)),
      {
        repoRoot: input.repoRoot,
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        tabs: [...input.tabs],
      },
    ],
    [input],
    { writeTargets: [input] },
  )
}

export function replaceWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  entries: readonly WorkspacePaneTabsEntry[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const currentEntries =
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot, repoRuntimeId)) ?? []
  updateWorkspacePaneTabsQueryData(repoRoot, repoRuntimeId, queryClient, () => entries, [
    ...currentEntries,
    ...entries,
  ])
}

export function restoreWorkspacePaneTabsTargetQueryData(
  input: {
    repoRoot: string
    repoRuntimeId: string
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
  updateWorkspacePaneTabsQueryData(
    input.repoRoot,
    input.repoRuntimeId,
    queryClient,
    (current) => [
      ...(current ?? []).filter((entry) => !workspacePaneTabsEntryMatchesTarget(entry, input)),
      ...(input.previousTargetEntry ? [input.previousTargetEntry] : []),
    ],
    [input],
    { writeTargets: [input] },
  )
  return true
}

export async function cancelWorkspacePaneTabs(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot, repoRuntimeId), exact: true })
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
  const refreshScope = startWorkspacePaneTabsManualRefresh(repoRoot, repoRuntimeId)
  try {
    const entries = await fetchWorkspacePaneTabsReadModel(repoRoot, repoRuntimeId, {
      startedProjectionVersion: refreshScope.startedProjectionVersion,
    })
    if (!workspacePaneTabsManualRefreshCurrent(refreshScope)) return
    replaceWorkspacePaneTabsQueryData(repoRoot, repoRuntimeId, entries, queryClient)
  } catch (err) {
    if (!isStaleWorkspacePaneTabsProjectionReadError(err)) throw err
  }
}

export function clearWorkspacePaneTabsProjectionState(repoRoot: string, repoRuntimeId: string): void {
  bumpWorkspacePaneTabsProjectionVersion(repoRoot, repoRuntimeId)
  const projectionKey = workspacePaneTabsProjectionKey(repoRoot, repoRuntimeId)
  workspacePaneTabsManualRefreshVersion.delete(projectionKey)
  clearWorkspacePaneTabsTargetVersions(projectionKey)
  clearWorkspacePaneTabsTargetWriteVersions(projectionKey)
}

export function workspacePaneTabsTargetVersion(input: {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
}): number {
  return workspacePaneTabsTargetGeneration.get(workspacePaneTabsTargetProjectionKey(input)) ?? 0
}

export function workspacePaneTabsTargetWriteVersion(input: {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
}): number {
  return workspacePaneTabsTargetWriteGeneration.get(workspacePaneTabsTargetProjectionKey(input)) ?? 0
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

function workspacePaneTabsProjectionKey(repoRoot: string, repoRuntimeId: string): string {
  return `${repoRoot}\0${repoRuntimeId}`
}

function workspacePaneTabsTargetProjectionKey(input: {
  repoRoot: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
}): string {
  return `${workspacePaneTabsProjectionKey(input.repoRoot, input.repoRuntimeId)}\0${workspacePaneTabsTargetIdentityKey(
    input,
  )}`
}

function bumpWorkspacePaneTabsTargetVersions(
  repoRoot: string,
  repoRuntimeId: string,
  targets: readonly WorkspacePaneTabsVersionTarget[],
): void {
  const targetKeys = new Set<string>()
  for (const target of targets) {
    targetKeys.add(
      workspacePaneTabsTargetProjectionKey({
        repoRoot,
        repoRuntimeId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
      }),
    )
  }
  for (const key of targetKeys) {
    workspacePaneTabsTargetGeneration.set(key, (workspacePaneTabsTargetGeneration.get(key) ?? 0) + 1)
  }
}

function bumpWorkspacePaneTabsTargetWriteVersions(
  repoRoot: string,
  repoRuntimeId: string,
  targets: readonly WorkspacePaneTabsVersionTarget[],
): void {
  const targetKeys = new Set<string>()
  for (const target of targets) {
    targetKeys.add(
      workspacePaneTabsTargetProjectionKey({
        repoRoot,
        repoRuntimeId,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
      }),
    )
  }
  for (const key of targetKeys) {
    workspacePaneTabsTargetWriteGeneration.set(key, (workspacePaneTabsTargetWriteGeneration.get(key) ?? 0) + 1)
  }
}

function clearWorkspacePaneTabsTargetVersions(projectionKey: string): void {
  const prefix = `${projectionKey}\0`
  for (const key of workspacePaneTabsTargetGeneration.keys()) {
    if (key.startsWith(prefix)) workspacePaneTabsTargetGeneration.delete(key)
  }
}

function clearWorkspacePaneTabsTargetWriteVersions(projectionKey: string): void {
  const prefix = `${projectionKey}\0`
  for (const key of workspacePaneTabsTargetWriteGeneration.keys()) {
    if (key.startsWith(prefix)) workspacePaneTabsTargetWriteGeneration.delete(key)
  }
}

function currentWorkspacePaneTabsProjectionVersion(repoRoot: string, repoRuntimeId: string): number {
  return workspacePaneTabsProjectionVersion.get(workspacePaneTabsProjectionKey(repoRoot, repoRuntimeId)) ?? 0
}

function bumpWorkspacePaneTabsProjectionVersion(repoRoot: string, repoRuntimeId: string): void {
  const key = workspacePaneTabsProjectionKey(repoRoot, repoRuntimeId)
  workspacePaneTabsProjectionVersion.set(key, ++workspacePaneTabsNextProjectionVersion)
}

function startWorkspacePaneTabsManualRefresh(
  repoRoot: string,
  repoRuntimeId: string,
): WorkspacePaneTabsManualRefreshScope {
  const projectionKey = workspacePaneTabsProjectionKey(repoRoot, repoRuntimeId)
  const requestVersion = ++workspacePaneTabsNextManualRefreshVersion
  workspacePaneTabsManualRefreshVersion.set(projectionKey, requestVersion)
  return {
    projectionKey,
    requestVersion,
    startedProjectionVersion: currentWorkspacePaneTabsProjectionVersion(repoRoot, repoRuntimeId),
  }
}

function workspacePaneTabsManualRefreshCurrent(scope: WorkspacePaneTabsManualRefreshScope): boolean {
  return workspacePaneTabsManualRefreshVersion.get(scope.projectionKey) === scope.requestVersion
}

function isStaleWorkspacePaneTabsProjectionReadError(err: unknown): boolean {
  return err instanceof StaleWorkspacePaneTabsProjectionReadError
}

async function fetchWorkspacePaneTabsReadModel(
  repoRoot: string,
  repoRuntimeId: string,
  options: { startedProjectionVersion?: number } = {},
): Promise<WorkspacePaneTabsQueryData> {
  const startedVersion =
    options.startedProjectionVersion ?? currentWorkspacePaneTabsProjectionVersion(repoRoot, repoRuntimeId)
  const entries = normalizeWorkspacePaneTabsQueryData(await workspacePaneTabsClient.list({ repoRoot, repoRuntimeId }))
  if (startedVersion < currentWorkspacePaneTabsProjectionVersion(repoRoot, repoRuntimeId)) {
    throw new StaleWorkspacePaneTabsProjectionReadError()
  }
  return entries
}

function updateWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  queryClient: QueryClient,
  update: (current: WorkspacePaneTabsQueryData | undefined) => readonly WorkspacePaneTabsEntry[],
  affectedTargets: readonly WorkspacePaneTabsVersionTarget[],
  options: { writeTargets?: readonly WorkspacePaneTabsVersionTarget[] } = {},
): void {
  const queryKey = workspacePaneTabsQueryKey(repoRoot, repoRuntimeId)
  const current = queryClient.getQueryData<WorkspacePaneTabsQueryData>(queryKey)
  const accepted = acceptWorkspacePaneTabsQueryData(
    repoRoot,
    repoRuntimeId,
    current,
    update(current),
    affectedTargets,
    options,
  )
  queryClient.setQueryData<WorkspacePaneTabsQueryData>(queryKey, accepted)
  notifyWorkspacePaneTabsPersistenceChanged()
}

function acceptWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  current: WorkspacePaneTabsQueryData | undefined,
  next: readonly WorkspacePaneTabsEntry[],
  affectedTargets: readonly WorkspacePaneTabsVersionTarget[],
  options: { writeTargets?: readonly WorkspacePaneTabsVersionTarget[] } = {},
): WorkspacePaneTabsQueryData {
  const accepted = normalizeWorkspacePaneTabsQueryData(next)
  acceptedWorkspacePaneTabsQueryData.add(accepted)
  bumpWorkspacePaneTabsProjectionVersion(repoRoot, repoRuntimeId)
  bumpWorkspacePaneTabsTargetVersions(
    repoRoot,
    repoRuntimeId,
    affectedTargets.length > 0 ? affectedTargets : [...(current ?? []), ...accepted],
  )
  if (options.writeTargets && options.writeTargets.length > 0) {
    bumpWorkspacePaneTabsTargetWriteVersions(repoRoot, repoRuntimeId, options.writeTargets)
  }
  return accepted
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
