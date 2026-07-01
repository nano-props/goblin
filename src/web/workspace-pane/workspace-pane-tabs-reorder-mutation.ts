import { useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
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

interface WorkspacePaneTabsReorderTarget {
  repoRoot: string
  branchName: string
  worktreePath: string | null
  targetKey: string
}

interface WorkspacePaneTabsReorderDisplayOverride {
  targetKey: string
  sourceIdentity: string
  tabs: WorkspacePaneTabEntry[]
}

interface WorkspacePaneTabsReorderMutationContext {
  previousData: WorkspacePaneTabsQueryData | undefined
}

export function useWorkspacePaneTabsReorderMutation(input: {
  repoRoot: string
  branchName: string | null
  worktreePath: string | null
  canonicalTabs: readonly WorkspacePaneTabEntry[]
}): {
  displayTabs: readonly WorkspacePaneTabEntry[]
  reorderTabs: (tabs: readonly WorkspacePaneTabEntry[]) => void
} {
  const queryClient = useQueryClient()
  const target = useMemo(
    () =>
      input.branchName
        ? workspacePaneTabsReorderTarget({
            repoRoot: input.repoRoot,
            branchName: input.branchName,
            worktreePath: input.worktreePath,
          })
        : null,
    [input.branchName, input.repoRoot, input.worktreePath],
  )
  const canonicalIdentity = useMemo(
    () => workspacePaneTabEntryListIdentity(input.canonicalTabs),
    [input.canonicalTabs],
  )
  const [displayOverride, setDisplayOverride] = useState<WorkspacePaneTabsReorderDisplayOverride | null>(null)
  const activeDisplayOverride =
    displayOverride &&
    target &&
    displayOverride.targetKey === target.targetKey &&
    displayOverride.sourceIdentity === canonicalIdentity
      ? displayOverride
      : null

  useEffect(() => {
    if (displayOverride && !activeDisplayOverride) setDisplayOverride(null)
  }, [activeDisplayOverride, displayOverride])

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
      setDisplayOverride(null)
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
      if (nextIdentity === canonicalIdentity) {
        setDisplayOverride(null)
        return
      }
      const nextTabs = [...tabs]
      flushSync(() => {
        setDisplayOverride({
          targetKey: target.targetKey,
          sourceIdentity: canonicalIdentity,
          tabs: nextTabs,
        })
      })
      mutate({
        repoRoot: target.repoRoot,
        branchName: target.branchName,
        worktreePath: target.worktreePath,
        tabs: nextTabs,
      })
    },
    [canonicalIdentity, mutate, target],
  )

  const displayTabs = activeDisplayOverride ? activeDisplayOverride.tabs : input.canonicalTabs
  return { displayTabs, reorderTabs }
}

export function orderWorkspacePaneItemsByTabEntries<T>(
  items: readonly T[],
  tabs: readonly WorkspacePaneTabEntry[],
  getTabEntry: (item: T) => WorkspacePaneTabEntry | null,
): T[] {
  const itemByIdentity = new Map<string, T>()
  const used = new Set<string>()
  const nonSortableItems: T[] = []

  for (const item of items) {
    const entry = getTabEntry(item)
    if (!entry) {
      nonSortableItems.push(item)
      continue
    }
    itemByIdentity.set(workspacePaneTabEntryIdentity(entry), item)
  }

  const orderedItems: T[] = []
  for (const tab of tabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    const item = itemByIdentity.get(identity)
    if (!item || used.has(identity)) continue
    used.add(identity)
    orderedItems.push(item)
  }

  for (const item of items) {
    const entry = getTabEntry(item)
    if (!entry) continue
    const identity = workspacePaneTabEntryIdentity(entry)
    if (used.has(identity)) continue
    used.add(identity)
    orderedItems.push(item)
  }

  return [...orderedItems, ...nonSortableItems]
}

export function workspacePaneTabEntryListIdentity(tabs: readonly WorkspacePaneTabEntry[]): string {
  return tabs.map(workspacePaneTabEntryIdentity).join('\0')
}

function workspacePaneTabsReorderTarget(input: {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}): WorkspacePaneTabsReorderTarget {
  return {
    ...input,
    targetKey: `${input.repoRoot}\0${input.branchName}\0${input.worktreePath ?? ''}`,
  }
}
