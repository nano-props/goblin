import { useCallback, useMemo } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import {
  reportWorkspacePaneTabsFailure,
  updateWorkspacePaneTabsOnServer,
  writeCanonicalWorkspacePaneTabsSnapshot,
} from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { workspacePaneTabEntryListIdentity } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'

export interface WorkspacePaneTabsReorderMutationInput {
  repoRoot: string
  repoRuntimeId: string
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
            repoRuntimeId: input.repoRuntimeId,
            branchName: input.branchName,
            worktreePath: input.worktreePath,
          }
        : null,
    [input.branchName, input.repoRuntimeId, input.repoRoot, input.worktreePath],
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
    repoRuntimeId: string
    branchName: string
    worktreePath: string | null
  },
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onReorderRejected: (() => void) | undefined,
): Promise<void> {
  await runWorkspacePaneAction(
    {
      repoId: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
      branchName: target.branchName,
      worktreePath: target.worktreePath,
    },
    () => runWorkspacePaneTabsReorderInQueue(target, draggedTabs, queryClient, onReorderRejected),
  )
}

async function runWorkspacePaneTabsReorderInQueue(
  target: {
    repoRoot: string
    repoRuntimeId: string
    branchName: string
    worktreePath: string | null
  },
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onReorderRejected: (() => void) | undefined,
): Promise<void> {
  try {
    const snapshot = await updateWorkspacePaneTabsOnServer({
      ...target,
      operation: { type: 'reorder', tabIdentities: draggedTabs.map(workspacePaneTabEntryIdentity) },
    })
    writeCanonicalWorkspacePaneTabsSnapshot(target.repoRoot, target.repoRuntimeId, snapshot, queryClient)
  } catch (err) {
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
