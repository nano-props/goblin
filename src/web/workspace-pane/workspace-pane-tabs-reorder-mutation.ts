import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  cancelWorkspacePaneTabs,
  invalidateWorkspacePaneTabs,
  setWorkspacePaneTabsForBranchQueryData,
  workspacePaneTabsQueryKey,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  type CommitWorkspacePaneTabsInput,
  replaceWorkspacePaneTabs,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { gblLog } from '#/web/logger.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspacePaneTabsReorderMutationContext {
  previousData: WorkspacePaneTabsQueryData | undefined
}

export function useWorkspacePaneTabsReorderMutation(input: {
  repoRoot: string
  branchName: string | null
  worktreePath: string | null
  canonicalTabs: readonly WorkspacePaneTabEntry[]
  onReorderError?: () => void
}): {
  reorderTabs: (tabs: readonly WorkspacePaneTabEntry[]) => void
} {
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
  const canonicalIdentity = useMemo(
    () => workspacePaneTabEntryListIdentity(input.canonicalTabs),
    [input.canonicalTabs],
  )

  const { mutate } = useMutation<
    WorkspacePaneTabEntry[],
    unknown,
    CommitWorkspacePaneTabsInput,
    WorkspacePaneTabsReorderMutationContext
  >({
    mutationFn: replaceWorkspacePaneTabs,
    onMutate: async (variables) => {
      await cancelWorkspacePaneTabs(variables.repoRoot, queryClient)
      const previousData = queryClient.getQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(variables.repoRoot),
      )
      setWorkspacePaneTabsForBranchQueryData(
        {
          repoRoot: variables.repoRoot,
          branchName: variables.branchName,
          worktreePath: variables.worktreePath,
          tabs: variables.tabs,
        },
        queryClient,
      )
      return { previousData }
    },
    onSuccess: (serverTabs, variables) => {
      setWorkspacePaneTabsForBranchQueryData(
        {
          repoRoot: variables.repoRoot,
          branchName: variables.branchName,
          worktreePath: variables.worktreePath,
          tabs: serverTabs,
        },
        queryClient,
      )
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(variables.repoRoot),
        context?.previousData ?? [],
      )
      invalidateWorkspacePaneTabs(variables.repoRoot, queryClient)
      input.onReorderError?.()
      gblLog.warn('workspace pane tabs mutation failed', {
        repoRoot: variables.repoRoot,
        worktreePath: variables.worktreePath,
        err,
      })
    },
  })

  const reorderTabs = useCallback(
    (tabs: readonly WorkspacePaneTabEntry[]) => {
      if (!target) return
      const nextIdentity = workspacePaneTabEntryListIdentity(tabs)
      if (nextIdentity === canonicalIdentity) return
      const nextTabs = [...tabs]
      mutate({
        repoRoot: target.repoRoot,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        tabs: nextTabs,
      })
    },
    [canonicalIdentity, mutate, target],
  )

  return { reorderTabs }
}
