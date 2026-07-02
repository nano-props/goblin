import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabsEntry } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  type WorkspacePaneTabsTarget,
  workspacePaneTabsEntryMatchesTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import { terminalClient } from '#/web/terminal.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { defaultWorkspacePaneTabs, normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'

export type WorkspacePaneTabsQueryData = WorkspacePaneTabsEntry[]

export function workspacePaneTabsQueryKey(repoRoot: string, repoInstanceId: string) {
  return ['workspace-pane-tabs', repoRoot, repoInstanceId] as const
}

export function isWorkspacePaneTabsQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'workspace-pane-tabs' && typeof queryKey[1] === 'string' && typeof queryKey[2] === 'string'
}

export function workspacePaneTabsQueryOptions(repoRoot: string, repoInstanceId: string) {
  return queryOptions({
    queryKey: workspacePaneTabsQueryKey(repoRoot, repoInstanceId),
    queryFn: async () =>
      normalizeWorkspacePaneTabsQueryData(await terminalClient.listWorkspaceTabs({ repoRoot, repoInstanceId })),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export function useWorkspacePaneTabsQuery(repoRoot: string, repoInstanceId: string) {
  return useQuery(workspacePaneTabsQueryOptions(repoRoot, repoInstanceId))
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
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(target.repoRoot, target.repoInstanceId)) ??
    []
  return workspacePaneTabsForTargetFromQueryData(data, target)
}

export async function fetchWorkspacePaneTabsForTarget(input: {
  repoRoot: string
  repoInstanceId: string
  branchName: string
  worktreePath: string | null
  queryClient?: QueryClient
}): Promise<WorkspacePaneTabEntry[]> {
  const queryClient = input.queryClient ?? primaryWindowQueryClient
  const data = await queryClient.fetchQuery(workspacePaneTabsQueryOptions(input.repoRoot, input.repoInstanceId))
  return workspacePaneTabsForTargetFromQueryData(data, input)
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
  queryClient.setQueryData<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(input.repoRoot, input.repoInstanceId),
    (current) => {
      return normalizeWorkspacePaneTabsQueryData([
        ...(current ?? []).filter((entry) => !workspacePaneTabsEntryMatchesTarget(entry, input)),
        {
          repoRoot: input.repoRoot,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          tabs: [...input.tabs],
        },
      ])
    },
  )
}

export async function cancelWorkspacePaneTabs(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot, repoInstanceId), exact: true })
}

export function invalidateWorkspacePaneTabs(
  repoRoot: string,
  repoInstanceId: string,
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  void queryClient.invalidateQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot, repoInstanceId), exact: true })
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
