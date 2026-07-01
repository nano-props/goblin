import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabsEntry } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { terminalBridge } from '#/web/terminal.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { defaultWorkspacePaneTabs, normalizeWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs.ts'

export type WorkspacePaneTabsQueryData = WorkspacePaneTabsEntry[]

export function workspacePaneTabsQueryKey(repoRoot: string) {
  return ['workspace-pane-tabs', repoRoot] as const
}

export function isWorkspacePaneTabsQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'workspace-pane-tabs' && typeof queryKey[1] === 'string'
}

export function workspacePaneTabsQueryOptions(repoRoot: string) {
  return queryOptions({
    queryKey: workspacePaneTabsQueryKey(repoRoot),
    queryFn: async () => normalizeWorkspacePaneTabsQueryData(await terminalBridge.listWorkspaceTabs({ repoRoot })),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })
}

export function useWorkspacePaneTabsQuery(repoRoot: string) {
  return useQuery(workspacePaneTabsQueryOptions(repoRoot))
}

export function readWorkspacePaneTabsForBranch(
  repoRoot: string,
  branchName: string | null | undefined,
  queryClient: QueryClient = primaryWindowQueryClient,
): WorkspacePaneTabEntry[] {
  const data = queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot)) ?? []
  return workspacePaneTabsForBranchFromQueryData(data, branchName)
}

export async function fetchWorkspacePaneTabsForBranch(input: {
  repoRoot: string
  branchName: string
  queryClient?: QueryClient
}): Promise<WorkspacePaneTabEntry[]> {
  const queryClient = input.queryClient ?? primaryWindowQueryClient
  const data = await queryClient.fetchQuery(workspacePaneTabsQueryOptions(input.repoRoot))
  return workspacePaneTabsForBranchFromQueryData(data, input.branchName)
}

export function workspacePaneTabsForBranchFromQueryData(
  data: readonly WorkspacePaneTabsEntry[],
  branchName: string | null | undefined,
): WorkspacePaneTabEntry[] {
  if (!branchName) return []
  return [...(data.find((entry) => entry.branchName === branchName)?.tabs ?? defaultWorkspacePaneTabs())]
}

export function setWorkspacePaneTabsForBranchQueryData(
  input: {
    repoRoot: string
    branchName: string
    worktreePath: string | null
    tabs: readonly WorkspacePaneTabEntry[]
  },
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  queryClient.setQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(input.repoRoot), (current) => {
    return normalizeWorkspacePaneTabsQueryData([
      ...(current ?? []).filter((entry) => entry.branchName !== input.branchName),
      {
        repoRoot: input.repoRoot,
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        tabs: [...input.tabs],
      },
    ])
  })
}

export async function cancelWorkspacePaneTabs(repoRoot: string, queryClient: QueryClient = primaryWindowQueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot), exact: true })
}

export function invalidateWorkspacePaneTabs(repoRoot: string, queryClient: QueryClient = primaryWindowQueryClient): void {
  void queryClient.invalidateQueries({ queryKey: workspacePaneTabsQueryKey(repoRoot), exact: true })
}

export function workspacePaneTabsByBranchFromQueryData(
  data: readonly WorkspacePaneTabsEntry[],
): Record<string, WorkspacePaneTabEntry[]> {
  const byBranch: Record<string, WorkspacePaneTabEntry[]> = {}
  for (const entry of data) {
    if (!entry.branchName || entry.branchName.includes('\0')) continue
    byBranch[entry.branchName] = normalizeWorkspacePaneTabs(entry.tabs, { hasWorktree: entry.worktreePath !== null })
  }
  return byBranch
}

function normalizeWorkspacePaneTabsQueryData(
  entries: readonly WorkspacePaneTabsEntry[],
): WorkspacePaneTabsQueryData {
  const byBranch = new Map<string, WorkspacePaneTabsEntry>()
  for (const entry of entries) {
    if (!entry.branchName || entry.branchName.includes('\0')) continue
    byBranch.set(entry.branchName, {
      repoRoot: entry.repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
      tabs: normalizeWorkspacePaneTabs(entry.tabs, { hasWorktree: entry.worktreePath !== null }),
    })
  }
  return Array.from(byBranch.values())
}
