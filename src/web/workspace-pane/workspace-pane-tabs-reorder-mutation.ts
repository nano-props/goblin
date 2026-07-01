import { useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  cancelWorkspacePaneTabs,
  invalidateWorkspacePaneTabs,
  readWorkspacePaneTabsForBranch,
  setWorkspacePaneTabsForBranchQueryData,
  workspacePaneTabsQueryKey,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { replaceWorkspacePaneTabsOnServer } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { gblLog } from '#/web/logger.ts'
import { runWorkspacePaneTabsOperation } from '#/web/workspace-pane/workspace-pane-tabs-operation-queue.ts'
import {
  workspacePaneTabEntryListIdentity,
  workspacePaneTabsWithDraggedOrder,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

export interface WorkspacePaneTabsReorderMutationInput {
  repoRoot: string
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
            branchName: input.branchName,
            worktreePath: input.worktreePath,
          }
        : null,
    [input.branchName, input.repoRoot, input.worktreePath],
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
        await cancelWorkspacePaneTabs(target.repoRoot, queryClient)
        const currentTabs = readWorkspacePaneTabsForBranch(target.repoRoot, target.branchName, queryClient)
        const nextTabs = workspacePaneTabsWithDraggedOrder(currentTabs, draggedTabs)
        if (workspacePaneTabEntryListIdentity(nextTabs) === workspacePaneTabEntryListIdentity(currentTabs)) return
        const previousQueryData = queryClient.getQueryData<WorkspacePaneTabsQueryData>(
          workspacePaneTabsQueryKey(target.repoRoot),
        )
        setWorkspacePaneTabsForBranchQueryData(
          {
            repoRoot: target.repoRoot,
            branchName: target.branchName,
            worktreePath: target.worktreePath,
            tabs: nextTabs,
          },
          queryClient,
        )
        try {
          const serverTabs = await replaceWorkspacePaneTabsOnServer({
            repoRoot: target.repoRoot,
            branchName: target.branchName,
            worktreePath: target.worktreePath,
            tabs: nextTabs,
          })
          setWorkspacePaneTabsForBranchQueryData(
            {
              repoRoot: target.repoRoot,
              branchName: target.branchName,
              worktreePath: target.worktreePath,
              tabs: serverTabs,
            },
            queryClient,
          )
        } catch (err) {
          queryClient.setQueryData<WorkspacePaneTabsQueryData>(
            workspacePaneTabsQueryKey(target.repoRoot),
            previousQueryData ?? [],
          )
          invalidateWorkspacePaneTabs(target.repoRoot, queryClient)
          input.onReorderRejected?.()
          gblLog.warn('workspace pane tabs mutation failed', {
            repoRoot: target.repoRoot,
            worktreePath: target.worktreePath,
            err,
          })
        }
      })
    },
    [canonicalTabsIdentity, input.onReorderRejected, queryClient, target],
  )

  return { reorderTabs }
}
