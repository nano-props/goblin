import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  reportWorkspacePaneTabsFailure,
  updateWorkspacePaneTabsOnServer,
  writeCanonicalWorkspacePaneTabsForTarget,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { runWorkspacePaneTabsOperation } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'
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
      void runWorkspacePaneTabsOperation(target, async () => {
        await cancelWorkspacePaneTabs(target.repoRoot, target.repoInstanceId, queryClient)
        const currentTabs = readWorkspacePaneTabsForTarget(target, queryClient)
        const nextTabs = workspacePaneTabsWithDraggedOrder(currentTabs, draggedTabs)
        if (workspacePaneTabEntryListIdentity(nextTabs) === workspacePaneTabEntryListIdentity(currentTabs)) return
        const previousTargetEntry = queryClient
          .getQueryData<WorkspacePaneTabsQueryData>(
            workspacePaneTabsQueryKey(target.repoRoot, target.repoInstanceId),
          )
          ?.find((entry) => workspacePaneTabsEntryMatchesTarget(entry, target))
        // Optimistic cache only: server runtime remains canonical. Success
        // below replaces this projection with server-returned tabs; failure
        // restores the prior target because the rejected mutation did not
        // produce a new server projection.
        setWorkspacePaneTabsForTargetQueryData(
          {
            repoRoot: target.repoRoot,
            repoInstanceId: target.repoInstanceId,
            branchName: target.branchName,
            worktreePath: target.worktreePath,
            tabs: nextTabs,
          },
          queryClient,
        )
        try {
          const serverTabs = await updateWorkspacePaneTabsOnServer({
            repoRoot: target.repoRoot,
            repoInstanceId: target.repoInstanceId,
            branchName: target.branchName,
            worktreePath: target.worktreePath,
            operation: { type: 'reorder', tabIdentities: draggedTabs.map(workspacePaneTabEntryIdentity) },
          })
          await writeCanonicalWorkspacePaneTabsForTarget(
            {
              repoRoot: target.repoRoot,
              repoInstanceId: target.repoInstanceId,
              branchName: target.branchName,
              worktreePath: target.worktreePath,
              tabs: serverTabs,
            },
            queryClient,
          )
        } catch (err) {
          restoreWorkspacePaneTabsTargetQueryData(
            {
              repoRoot: target.repoRoot,
              repoInstanceId: target.repoInstanceId,
              branchName: target.branchName,
              worktreePath: target.worktreePath,
              previousTargetEntry,
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
          input.onReorderRejected?.()
        }
      })
    },
    [canonicalTabsIdentity, input.onReorderRejected, queryClient, target],
  )

  return { reorderTabs }
}
