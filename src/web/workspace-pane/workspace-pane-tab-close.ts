import {
  workspacePaneTerminalBaseForTabModel,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  canCloseWorkspacePaneRuntimeTabWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import { confirmWorkspacePaneRuntimeTabClose } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

type WorkspacePaneTabCloseStart =
  { accepted: false; completion: null } | { accepted: true; completion: Promise<boolean> }

export function beginWorkspacePaneTabEntryClose(
  target: WorkspacePaneTabModel,
  entry: WorkspacePaneTabEntry,
): WorkspacePaneTabCloseStart {
  if (!isWorkspacePaneRuntimeTabEntry(entry)) {
    return {
      accepted: true,
      completion: workspacePaneTabProvider(entry.type).close({
        closeStaticTab: closeStaticTabWithCommit(target),
      }),
    }
  }
  const closeTarget = workspacePaneTerminalBaseForTabModel(target)
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  if (
    !closeTarget ||
    !canCloseWorkspacePaneRuntimeTabWithContext({ type: entry.type, target: closeTarget }, closeContext)
  ) {
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

function closeStaticTabWithCommit(target: WorkspacePaneTabModel) {
  return async (type: WorkspacePaneStaticTabType): Promise<boolean> => {
    const workspace = useWorkspacesStore.getState().workspaces[target.workspaceId]
    if (!workspace) return false
    if (target.paneTarget.kind === 'inactive') return false
    const persistenceTarget = target.paneTarget
    const result = await updateWorkspacePaneTabs({
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      ...persistenceTarget,
      operation: { type: 'close-static', tabType: type },
    })
    return result.ok
  }
}
