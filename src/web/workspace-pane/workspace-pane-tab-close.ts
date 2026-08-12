import {
  workspacePaneTerminalBaseForTabModel,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'
import { readWorkspacePaneRuntimeTabCloseContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import { confirmWorkspacePaneRuntimeTabClose } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import type { WorkspacePaneTabCloseOutcome } from '#/web/workspace-pane/workspace-pane-tab-close-outcome.ts'

type WorkspacePaneTabCloseStart =
  { accepted: false; completion: null } | { accepted: true; completion: Promise<WorkspacePaneTabCloseOutcome> }

export function beginWorkspacePaneTabEntryClose(
  target: WorkspacePaneTabModel,
  entry: WorkspacePaneTabEntry,
): WorkspacePaneTabCloseStart {
  if (!isWorkspacePaneRuntimeTabEntry(entry)) {
    return {
      accepted: true,
      completion: closeStaticWorkspacePaneTab(target, entry.type),
    }
  }
  const closeTarget = workspacePaneTerminalBaseForTabModel(target)
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  if (!closeTarget || !closeContext) {
    return { accepted: false, completion: null }
  }
  return {
    accepted: true,
    completion: confirmWorkspacePaneRuntimeTabClose(
      { type: entry.type, sessionId: entry.runtimeSessionId, target: closeTarget },
      closeContext,
    ),
  }
}

async function closeStaticWorkspacePaneTab(
  target: WorkspacePaneTabModel,
  type: WorkspacePaneStaticTabType,
): Promise<WorkspacePaneTabCloseOutcome> {
  const workspace = workspacesStore.getState().workspaces[target.workspaceId]
  if (!workspace || target.paneTarget.kind === 'inactive') return { kind: 'not-committed', message: null }
  const persistenceTarget = target.paneTarget
  const result = await updateWorkspacePaneTabs({
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    ...persistenceTarget,
    operation: { type: 'close-static', tabType: type },
  })
  if (result.ok) return { kind: 'committed', projection: result.projection }
  if (result.error instanceof ClientRealtimeRequestError) throw result.error
  return { kind: 'not-committed', message: result.message }
}
