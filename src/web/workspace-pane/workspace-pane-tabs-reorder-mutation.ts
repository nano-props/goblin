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
import {
  workspacePaneTabEntryListIdentity,
  workspacePaneTabsWithSurfaceOrder,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { runWorkspacePaneAction } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import {
  workspacePaneTabsBranchIdentity,
  workspacePaneTabsTargetWorktreePath,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { translate } from '#/web/stores/i18n-vue.ts'
import { toast } from 'vue-sonner'
import { readWorkspacePaneTabsProjectionForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'
import { workspacePaneLocationIsCurrent } from '#/web/workspace-pane/workspace-pane-tab-target.ts'

export interface WorkspacePaneTabsReorderMutationInput {
  location: WorkspacePaneLocation
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
    if (!workspacePaneLocationIsCurrent(current.location)) {
      onSettled?.()
      return
    }
    const nextTabs = workspacePaneTabsWithSurfaceOrder(current.canonicalTabs, tabs)
    const nextIdentity = workspacePaneTabEntryListIdentity(nextTabs)
    if (nextIdentity === workspacePaneTabEntryListIdentity(current.canonicalTabs)) {
      onSettled?.()
      return
    }
    void runWorkspacePaneTabsReorder(current.location, nextTabs, queryClient, onSettled)
  }

  return { reorderTabs }
}

async function runWorkspacePaneTabsReorder(
  location: WorkspacePaneLocation,
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
  onSettled: (() => void) | undefined,
): Promise<void> {
  try {
    await runWorkspacePaneAction(location, () => runWorkspacePaneTabsReorderInQueue(location, draggedTabs, queryClient))
  } finally {
    onSettled?.()
  }
}

async function runWorkspacePaneTabsReorderInQueue(
  location: WorkspacePaneLocation,
  draggedTabs: readonly WorkspacePaneTabEntry[],
  queryClient: QueryClient,
): Promise<void> {
  if (!workspacePaneLocationIsCurrent(location)) return
  const target = workspacePaneTabsReorderTarget(location)
  try {
    if (readWorkspacePaneTabsProjectionForTarget(target, queryClient).phase !== 'ready') {
      const messageKey = 'error.workspace-tabs-reorder-unavailable'
      toast.warning(translate(messageKey), { id: 'workspace-pane-tabs-reorder-unavailable' })
      return
    }
    const result = await updateWorkspacePaneTabsOnServer({
      ...target,
      operation: { type: 'reorder', tabIdentities: draggedTabs.map(workspacePaneTabEntryIdentity) },
    })
    if (result.kind === 'committed-projection-failed') {
      const messageKey = 'error.workspace-tabs-committed-projection-failed'
      toast.warning(translate(messageKey), { id: 'workspace-pane-tabs-reorder-projection-failed' })
      return
    }
    writeCanonicalWorkspacePaneTabsSnapshot(target.workspaceId, target.workspaceRuntimeId, result.snapshot, queryClient)
  } catch (err) {
    reportWorkspacePaneTabsFailure({
      operation: 'reorder',
      workspaceId: target.workspaceId,
      branchName: workspacePaneTabsBranchIdentity(target),
      worktreePath: workspacePaneTabsTargetWorktreePath(target),
      error: err,
    })
    if (err instanceof ClientRealtimeRequestError && err.delivery === 'indeterminate') {
      const messageKey = 'error.workspace-tabs-outcome-uncertain'
      toast.warning(translate(messageKey), { id: 'workspace-pane-tabs-outcome-uncertain' })
      return
    }
    const messageKey = 'error.workspace-operation-failed'
    toast.error(translate(messageKey), { id: 'workspace-pane-tabs-reorder-failed' })
  }
}

type WorkspacePaneTabsReorderTarget = WorkspacePaneTabsTarget & { workspaceRuntimeId: string }

function workspacePaneTabsReorderTarget(location: WorkspacePaneLocation): WorkspacePaneTabsReorderTarget {
  return { ...location.paneTarget, workspaceRuntimeId: location.workspaceRuntimeId }
}
