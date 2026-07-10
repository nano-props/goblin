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
  if (tab.kind === 'static' && !target.branchName) return { accepted: false, completion: null }
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
      repoId: target.repoId,
      branchName: target.branchName,
      closeStaticTab: closeStaticTabWithCommit(target.worktreePath),
    }),
  }
}

function closeStaticTabWithCommit(worktreePath: string | null) {
  return async (repoId: string, type: WorkspacePaneStaticTabType, branchName: string): Promise<boolean> => {
    const repo = useReposStore.getState().repos[repoId]
    if (!repo) return false
    const result = await updateWorkspacePaneTabs({
      repoRoot: repoId,
      repoRuntimeId: repo.repoRuntimeId,
      branchName,
      worktreePath,
      operation: { type: 'close-static', tabType: type },
    })
    return result.ok
  }
}
