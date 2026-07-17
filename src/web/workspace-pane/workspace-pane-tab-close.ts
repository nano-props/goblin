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

type WorkspacePaneTabCloseStart =
  { accepted: false; completion: null } | { accepted: true; completion: Promise<boolean> }

export function beginWorkspacePaneTabClose(
  target: RepoWorkspaceTabModel,
  tab: RepoWorkspaceTab,
): WorkspacePaneTabCloseStart {
  if (tab.kind === 'pending') return { accepted: false, completion: null }
  const provider = workspacePaneTabProvider(tab.type)
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  const closeTarget = {
    repoRoot: target.repoId,
    repoRuntimeId: target.repoRuntimeId,
    branchName: target.branchName,
    worktreePath: target.worktreePath,
  }
  if (
    isRepoWorkspaceRuntimeTab(tab) &&
    !canCloseWorkspacePaneRuntimeTabWithContext(
      {
        type: tab.runtimeType,
        target: closeTarget,
      },
      closeContext,
    )
  ) {
    return { accepted: false, completion: null }
  }
  if (isRepoWorkspaceRuntimeTab(tab)) {
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
    const persistenceTarget =
      target.branchName === null
        ? { kind: 'workspace-root' as const, branchName: null, worktreePath: null }
        : { branchName: target.branchName, worktreePath: target.worktreePath }
    const result = await updateWorkspacePaneTabs({
      repoRoot: target.repoId,
      repoRuntimeId: repo.repoRuntimeId,
      ...persistenceTarget,
      operation: { type: 'close-static', tabType: type },
    })
    return result.ok
  }
}
