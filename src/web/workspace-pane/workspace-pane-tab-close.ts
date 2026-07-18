import type { RepoWorkspaceTab, RepoWorkspaceTabModel } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { isRepoWorkspaceRuntimeTab } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
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

export function beginWorkspacePaneTabClose(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
): WorkspacePaneTabCloseStart {
  if (tab.kind === 'pending') return { accepted: false, completion: null }
  const provider = workspacePaneTabProvider(tab.type)
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  const closeTarget = target.worktreePath
    ? workspacePaneTerminalBaseFromCoordinates({
        workspaceId: target.repoId,
        workspaceRuntimeId: target.repoRuntimeId,
        branchName: target.branchName,
        rootPath: target.worktreePath,
      })
    : null
  if (
    isRepoWorkspaceRuntimeTab(tab) &&
    (!closeTarget ||
      !canCloseWorkspacePaneRuntimeTabWithContext(
        {
          type: tab.runtimeType,
          target: closeTarget,
        },
        closeContext,
      ))
  ) {
    return { accepted: false, completion: null }
  }
  if (isRepoWorkspaceRuntimeTab(tab)) {
    if (!closeTarget) return { accepted: false, completion: null }
    return {
      accepted: true,
      completion: confirmWorkspacePaneRuntimeTabClose(
        {
          type: tab.runtimeType,
          sessionId: tab.sessionId,
          target: closeTarget,
        },
        closeContext,
      ),
    }
  }
  return {
    accepted: true,
    completion: provider.close({
      closeStaticTab: closeStaticTabWithCommit(target),
    }),
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
