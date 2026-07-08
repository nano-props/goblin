import { useCallback, useMemo } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsEntryMatchesTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabsQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  cancelWorkspacePaneTabs,
  readWorkspacePaneTabsForTarget,
  restoreWorkspacePaneTabsTargetQueryData,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsQueryKey,
  workspacePaneTabsTargetVersion,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  reportWorkspacePaneTabsFailure,
  updateWorkspacePaneTabsOnServer,
  writeCanonicalWorkspacePaneTabsForTarget,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  workspacePaneTabEntryListIdentity,
  workspacePaneTabsWithDraggedOrder,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

export interface WorkspacePaneTabsReorderMutationInput {
  repoRoot: string
  repoInstanceId: string
  branchName: string | null
  worktreePath: string | null
  canonicalTabs: readonly WorkspacePaneTabEntry[]
  onReorderRejected?: () => void
}

export interface WorkspacePaneTabsReorderMutationResult {
  reorderTabs: (tabs: readonly WorkspacePaneTabEntry[]) => void
}

export function useWorkspacePaneTabsReorderMutation(
  input: WorkspacePaneTabsReorderMutationInput,
): WorkspacePaneTabsReorderMutationResult {
  const queryClient = useQueryClient()
  const target = useMemo(
    () =>
      input.branchName
        ? {
            repoRoot: input.repoRoot,
            repoInstanceId: input.repoInstanceId,
            branchName: input.branchName,
            worktreePath: input.worktreePath,
          }
        : null,
    [input.branchName, input.repoInstanceId, input.repoRoot, input.worktreePath],
  )
  const canonicalTabsIdentity = useMemo(
    () => workspacePaneTabEntryListIdentity(input.canonicalTabs),
    [input.canonicalTabs],
  )

  const reorderTabs = useCallback(
    (tabs: readonly WorkspacePaneTabEntry[]) => {
      if (!target) return
      const nextIdentity = workspacePaneTabEntryListIdentity(tabs)
      if (nextIdentity === canonicalTabsIdentity) return
      const draggedTabs = [...tabs]
      void runWorkspacePaneTabsReorder(target, draggedTabs, queryClient, input.onReorderRejected)
    },
    [canonicalTabsIdentity, input.onReorderRejected, queryClient, target],
  )

  return { reorderTabs }
}

async function runWorkspacePaneTabsReorder(
  target: {
    repoRoot: string
    repoInstanceId: string
    branchName: string
    worktreePath: string | null
  },
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onReorderRejected: (() => void) | undefined,
): Promise<void> {
  const currentTabs = readWorkspacePaneTabsForTarget(target, queryClient)
  const nextTabs = workspacePaneTabsWithDraggedOrder(currentTabs, draggedTabs)
  if (workspacePaneTabEntryListIdentity(nextTabs) === workspacePaneTabEntryListIdentity(currentTabs)) return
  const cancelListQueries = cancelWorkspacePaneTabs(target.repoRoot, target.repoInstanceId, queryClient)
  const previousTargetEntry = queryClient
    .getQueryData<WorkspacePaneTabsQueryData>(workspacePaneTabsQueryKey(target.repoRoot, target.repoInstanceId))
    ?.find((entry) => workspacePaneTabsEntryMatchesTarget(entry, target))
  setWorkspacePaneTabsForTargetQueryData({ ...target, tabs: nextTabs }, queryClient)
  const optimisticTargetVersion = workspacePaneTabsTargetVersion(target)
  try {
    await cancelListQueries
    const serverTabs = await updateWorkspacePaneTabsOnServer({
      ...target,
      operation: { type: 'reorder', tabIdentities: draggedTabs.map(workspacePaneTabEntryIdentity) },
    })
    if (workspacePaneTabsTargetVersion(target) !== optimisticTargetVersion) return
    const accepted = await writeCanonicalWorkspacePaneTabsForTarget({ ...target, tabs: serverTabs }, queryClient)
    if (!accepted) return
  } catch (err) {
    restoreWorkspacePaneTabsTargetQueryData(
      {
        ...target,
        previousTargetEntry,
        expectedTargetVersion: optimisticTargetVersion,
      },
      queryClient,
    )
    reportWorkspacePaneTabsFailure({
      operation: 'reorder',
      repoRoot: target.repoRoot,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
      error: err,
    })
    onReorderRejected?.()
  }
}
