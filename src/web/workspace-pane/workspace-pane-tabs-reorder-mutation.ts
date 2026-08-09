import { toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { QueryClient } from '@tanstack/query-core'
import { useQueryClient } from '@tanstack/vue-query'
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
  runtimeWorkspacePaneTarget,
  workspacePaneTabsBranchIdentity,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'

export type WorkspacePaneTabsReorderMutationInput = WorkspacePaneTabsTarget & {
  workspaceRuntimeId: string
  canonicalTabs: readonly WorkspacePaneTabEntry[]
}

export interface WorkspacePaneTabsReorderMutationResult {
  reorderTabs: (tabs: readonly WorkspacePaneTabEntry[], onSettled?: () => void) => void
}

export function useWorkspacePaneTabsReorderMutation(
  input: MaybeRefOrGetter<WorkspacePaneTabsReorderMutationInput>,
): WorkspacePaneTabsReorderMutationResult {
  const queryClient = useQueryClient()
  const reorderTabs = (tabs: readonly WorkspacePaneTabEntry[], onSettled?: () => void) => {
    const current = toValue(input)
    const target = workspacePaneTabsReorderTarget(current)
    if (!target) {
      onSettled?.()
      return
    }
    const nextIdentity = workspacePaneTabEntryListIdentity(tabs)
    if (nextIdentity === workspacePaneTabEntryListIdentity(current.canonicalTabs)) {
      onSettled?.()
      return
    }
    void runWorkspacePaneTabsReorder(target, [...tabs], queryClient, onSettled)
  }

  return { reorderTabs }
}

function workspacePaneTabsReorderTarget(
  input: WorkspacePaneTabsReorderMutationInput,
): WorkspacePaneTabsReorderTarget | null {
  if (!runtimeWorkspacePaneTarget(input, input.workspaceRuntimeId)) return null
  if (input.kind === 'workspace-root') {
    return { kind: 'workspace-root', workspaceId: input.workspaceId, workspaceRuntimeId: input.workspaceRuntimeId }
  }
  if (input.kind === 'git-branch') {
    return {
      kind: 'git-branch',
      workspaceId: input.workspaceId,
      workspaceRuntimeId: input.workspaceRuntimeId,
      branchName: input.branchName,
    }
  }
  return {
    kind: 'git-worktree',
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    worktreePath: input.worktreePath,
  }
}

async function runWorkspacePaneTabsReorder(
  target: WorkspacePaneTabsReorderTarget,
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onSettled: (() => void) | undefined,
): Promise<void> {
  try {
    await runWorkspacePaneAction(workspacePaneReorderActionTarget(target), () =>
      runWorkspacePaneTabsReorderInQueue(target, draggedTabs, queryClient),
    )
  } finally {
    onSettled?.()
  }
}

async function runWorkspacePaneTabsReorderInQueue(
  target: WorkspacePaneTabsReorderTarget,
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
): Promise<void> {
  try {
    const snapshot = await updateWorkspacePaneTabsOnServer({
      ...target,
      operation: { type: 'reorder', tabIdentities: draggedTabs.map(workspacePaneTabEntryIdentity) },
    })
    writeCanonicalWorkspacePaneTabsSnapshot(target.workspaceId, target.workspaceRuntimeId, snapshot, queryClient)
  } catch (err) {
    reportWorkspacePaneTabsFailure({
      operation: 'reorder',
      workspaceId: target.workspaceId,
      branchName: workspacePaneTabsBranchIdentity(target),
      worktreePath: workspacePaneTabsTargetWorktreePath(target),
      error: err,
    })
  }
}

type WorkspacePaneTabsReorderTarget = WorkspacePaneTabsTarget & { workspaceRuntimeId: string }

function workspacePaneReorderActionTarget(target: WorkspacePaneTabsReorderTarget): WorkspacePaneActionTarget {
  return workspacePaneActionTargetFromCoordinates({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: workspacePaneTabsBranchIdentity(target),
    worktreePath: workspacePaneTabsTargetWorktreePath(target),
  })
}
