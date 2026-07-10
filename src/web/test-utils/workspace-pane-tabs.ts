import type { QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneTabsEntryMatchesTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  type WorkspacePaneTabsQueryData,
  workspacePaneTabsQueryKey,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

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
  const current = currentSnapshot(input.repoRoot, input.repoRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    input.repoRoot,
    input.repoRuntimeId,
    {
      revision: current.revision,
      entries: [
        ...current.entries.filter((entry) => !workspacePaneTabsEntryMatchesTarget(entry, input)),
        {
          repoRoot: input.repoRoot,
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          tabs: [...input.tabs],
        },
      ],
    },
    queryClient,
  )
}

export function replaceWorkspacePaneTabsQueryData(
  repoRoot: string,
  repoRuntimeId: string,
  entries: readonly WorkspacePaneTabsEntry[],
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const current = currentSnapshot(repoRoot, repoRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    repoRoot,
    repoRuntimeId,
    { revision: current.revision, entries: [...entries] },
    queryClient,
  )
}

function currentSnapshot(repoRoot: string, repoRuntimeId: string, queryClient: QueryClient): WorkspacePaneTabsSnapshot {
  return (
    queryClient.getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(repoRoot, repoRuntimeId)) ?? {
      revision: 0,
      entries: [],
    }
  )
}
