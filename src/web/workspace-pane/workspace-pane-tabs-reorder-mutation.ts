import { useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  cancelWorkspacePaneTabs,
  invalidateWorkspacePaneTabs,
  setWorkspacePaneTabsForBranchQueryData,
  workspacePaneTabsForBranchFromQueryData,
  workspacePaneTabsQueryKey,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  type CommitWorkspacePaneTabsInput,
  replaceWorkspacePaneTabs,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { gblLog } from '#/web/logger.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspacePaneTabsReorderMutationContext {
  previousQueryData: WorkspacePaneTabsQueryData | undefined
}

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

  const { mutate } = useMutation<
    WorkspacePaneTabEntry[],
    unknown,
    CommitWorkspacePaneTabsInput,
    WorkspacePaneTabsReorderMutationContext
  >({
    mutationFn: replaceWorkspacePaneTabs,
    onMutate: async (variables) => {
      await cancelWorkspacePaneTabs(variables.repoRoot, queryClient)
      const previousQueryData = queryClient.getQueryData<WorkspacePaneTabsQueryData>(
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
      return { previousQueryData }
    },
    onSuccess: (serverTabs, variables) => {
      if (!workspacePaneTabsMutationStillCurrent(variables, queryClient)) return
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
      if (!workspacePaneTabsMutationStillCurrent(variables, queryClient)) return
      queryClient.setQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(variables.repoRoot),
        context?.previousQueryData ?? [],
      )
      invalidateWorkspacePaneTabs(variables.repoRoot, queryClient)
      input.onReorderRejected?.()
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
      if (nextIdentity === canonicalTabsIdentity) return
      const nextTabs = [...tabs]
      mutate({
        repoRoot: target.repoRoot,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        tabs: nextTabs,
      })
    },
    [canonicalTabsIdentity, mutate, target],
  )

  return { reorderTabs }
}

function workspacePaneTabsMutationStillCurrent(
  variables: CommitWorkspacePaneTabsInput,
  queryClient: QueryClient,
): boolean {
  const currentData = queryClient.getQueryData<WorkspacePaneTabsQueryData>(
    workspacePaneTabsQueryKey(variables.repoRoot),
  )
  const currentTabs = workspacePaneTabsForBranchFromQueryData(currentData ?? [], variables.branchName)
  return workspacePaneTabEntryListIdentity(currentTabs) === workspacePaneTabEntryListIdentity(variables.tabs)
}
