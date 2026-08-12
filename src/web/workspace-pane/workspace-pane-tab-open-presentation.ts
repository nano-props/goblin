import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { FilesystemWorkspacePaneRouteCommitActions } from '#/web/app-navigation-actions.ts'
import { selectWorkspacePaneControllerTab } from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  commitWorkspacePaneDestinationRoute,
  workspacePaneDestinationPresentationIsCurrent,
  type WorkspacePaneDestinationPresentation,
} from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import { appNavigationIsCurrent, type AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { translate } from '#/web/stores/i18n-vue.ts'
import { toast } from 'vue-sonner'

export type WorkspacePaneStaticTabRouteTransaction =
  | {
      kind: 'current'
      navigationGeneration: AppNavigationGeneration
    }
  | {
      kind: 'destination'
      presentation: WorkspacePaneDestinationPresentation
    }

export function workspacePaneStaticTabTransactionIsCurrent(
  transaction: WorkspacePaneStaticTabRouteTransaction,
): boolean {
  if (transaction.kind === 'current') return appNavigationIsCurrent(transaction.navigationGeneration)
  return workspacePaneDestinationPresentationIsCurrent(transaction.presentation)
}

export function showWorkspacePaneTabOpenMutationFailure(error: unknown): void {
  if (error instanceof ClientRealtimeRequestError && error.delivery === 'indeterminate') {
    const messageKey = 'error.workspace-tabs-outcome-uncertain'
    toast.warning(translate(messageKey), { id: 'workspace-pane-tabs-outcome-uncertain' })
    return
  }
  const messageKey = 'error.workspace-operation-failed'
  toast.error(translate(messageKey), { id: 'workspace-pane-tab-open-failed' })
}

export function showWorkspacePaneTabOpenCommittedProjectionFailure(): void {
  const messageKey = 'error.workspace-tabs-committed-projection-failed'
  toast.warning(translate(messageKey), { id: 'workspace-pane-tab-open-projection-failed' })
}

export async function commitWorkspacePaneStaticTabPresentation(
  input: {
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
    branchName: string | null
    worktreePath: string | null
    type: WorkspacePaneStaticTabType
    navigation: FilesystemWorkspacePaneRouteCommitActions
    model: WorkspacePaneTabModel
  },
  sourceRoute: ParsedWorkspacePaneRoute | null | undefined,
  transaction: WorkspacePaneStaticTabRouteTransaction,
): Promise<WorkspacePaneActionOutcome> {
  const route = { kind: 'static' as const, tab: input.type }
  if (transaction.kind === 'destination') {
    return commitWorkspacePaneDestinationRoute(transaction.presentation, route, input.navigation)
  }
  const tab = input.model.tabs.find((candidate) => candidate.type === input.type)
  if (!tab) return { kind: 'superseded' }
  const committed = await selectWorkspacePaneControllerTab(input.model, tab, input.navigation, {
    navigationGeneration: transaction.navigationGeneration,
  })
  if (!committed && !appNavigationIsCurrent(transaction.navigationGeneration)) {
    return { kind: 'completed', changed: true, presentation: 'superseded' }
  }
  return committed ? { kind: 'completed', changed: true, presentation: 'observed' } : { kind: 'navigation-rejected' }
}
