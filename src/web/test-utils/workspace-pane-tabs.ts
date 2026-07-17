import type { QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsEntry, WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  runtimeWorkspacePaneTarget,
  workspacePaneTabsTargetFromRuntime,
  workspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  type WorkspacePaneTabsQueryData,
  workspacePaneTabsQueryKey,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function setWorkspacePaneTabsForTargetQueryData(
  input: WorkspacePaneTabsTarget & { repoRuntimeId: string; tabs: readonly WorkspacePaneTabEntry[] },
  queryClient: QueryClient = primaryWindowQueryClient,
): void {
  const current = currentSnapshot(input.repoRoot, input.repoRuntimeId, queryClient)
  writeWorkspacePaneTabsSnapshotQueryData(
    input.repoRoot,
    input.repoRuntimeId,
    {
      revision: current.revision,
      entries: [
        ...current.entries.filter((entry) => {
          const target = workspacePaneTabsTargetFromRuntime(entry.target)
          return !target || workspacePaneTabsTargetIdentityKey(target) !== workspacePaneTabsTargetIdentityKey(input)
        }),
        {
          target: runtimeWorkspacePaneTargetForTest(input),
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

export function runtimeWorkspacePaneTargetForTest(input: WorkspacePaneTabsTarget & { repoRuntimeId: string }) {
  const target = runtimeWorkspacePaneTarget(input, input.repoRuntimeId)
  if (!target) throw new Error('workspace pane test target requires a canonical target')
  return target
}
