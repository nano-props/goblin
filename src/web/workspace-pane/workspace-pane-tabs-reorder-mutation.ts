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
import {
  runWorkspacePaneAction,
  workspacePaneActionTargetFromCoordinates,
  type WorkspacePaneActionTarget,
} from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  runtimeWorkspacePaneTarget,
  workspacePaneTabsBranchIdentity,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'

export type WorkspacePaneTabsReorderMutationInput = WorkspacePaneTabsTarget & {
  workspaceRuntimeId: string
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
  const target = useMemo(() => {
    const paneTarget = input
    return runtimeWorkspacePaneTarget(paneTarget, input.workspaceRuntimeId)
      ? { ...paneTarget, workspaceRuntimeId: input.workspaceRuntimeId }
      : null
  }, [input])
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
  target: WorkspacePaneTabsReorderTarget,
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onReorderRejected: (() => void) | undefined,
): Promise<void> {
  await runWorkspacePaneAction(workspacePaneReorderActionTarget(target), () =>
    runWorkspacePaneTabsReorderInQueue(target, draggedTabs, queryClient, onReorderRejected),
  )
}

async function runWorkspacePaneTabsReorderInQueue(
  target: WorkspacePaneTabsReorderTarget,
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onReorderRejected: (() => void) | undefined,
): Promise<void> {
  try {
    const snapshot = await updateWorkspacePaneTabsOnServer({
      ...target,
      operation: { type: 'reorder', tabIdentities: draggedTabs.map(workspacePaneTabEntryIdentity) },
    })
    writeCanonicalWorkspacePaneTabsSnapshot(target.repoRoot, target.workspaceRuntimeId, snapshot, queryClient)
  } catch (err) {
    reportWorkspacePaneTabsFailure({
      operation: 'reorder',
      repoRoot: target.repoRoot,
      branchName: workspacePaneTabsBranchIdentity(target),
      worktreePath: workspacePaneTabsTargetWorktreePath(target),
      error: err,
    })
    onReorderRejected?.()
  }
}

type WorkspacePaneTabsReorderTarget = WorkspacePaneTabsTarget & { workspaceRuntimeId: string }

function workspacePaneReorderActionTarget(target: WorkspacePaneTabsReorderTarget): WorkspacePaneActionTarget {
  return workspacePaneActionTargetFromCoordinates({
    workspaceId: target.repoRoot,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: workspacePaneTabsBranchIdentity(target),
    worktreePath: workspacePaneTabsTargetWorktreePath(target),
  })
}
