import type { RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
} from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { workspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  canCloseWorkspacePaneRuntimeTabWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import { confirmWorkspacePaneRuntimeTabClose } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import { workspacePaneTerminalBaseFromCoordinates } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { requiredGitWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

type WorkspacePaneTabCloseStart =
  { accepted: false; completion: null } | { accepted: true; completion: Promise<boolean> }

export function beginWorkspacePaneTabEntryClose(
  target: RepoWorkspaceTabModel,
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
  const closeTarget = target.worktreePath
    ? workspacePaneTerminalBaseFromCoordinates({
        workspaceId: target.repoId,
        workspaceRuntimeId: target.repoRuntimeId,
        branchName: target.branchName,
        rootPath: target.worktreePath,
      })
    : null
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

function closeStaticTabWithCommit(target: RepoWorkspaceTabModel) {
  return async (type: WorkspacePaneStaticTabType): Promise<boolean> => {
    const repo = useReposStore.getState().repos[target.repoId]
    if (!repo) return false
    if (target.paneTarget.kind === 'inactive') return false
    const persistenceTarget = target.paneTarget
    const result = await updateWorkspacePaneTabs({
      repoRuntimeId: repo.repoRuntimeId,
      ...persistenceTarget,
      operation: { type: 'close-static', tabType: type },
    })
    return result.ok
  }
}
