import type { RepoWorkspaceTab, RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { isRepoWorkspaceRuntimeTab } from '#/web/components/repo-workspace/tab-model.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  isWorkspacePaneStaticTabProvider,
  workspacePaneTabProvider,
  workspacePaneTabProviders,
} from '#/web/components/workspace-pane/tab-providers.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'
import {
  canCloseWorkspacePaneRuntimeTabWithContext,
  readWorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-context.ts'
import {
  closeWorkspacePaneRuntimeTabsForWorktree,
  confirmWorkspacePaneRuntimeTabClose,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

interface CloseWorkspacePaneTabsForWorktreeOptions {
  repoId: string
  branchName: string
  worktreePath: string
}

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

export async function closeWorkspacePaneTabsForWorktree({
  repoId,
  branchName,
  worktreePath,
}: CloseWorkspacePaneTabsForWorktreeOptions): Promise<boolean> {
  const target = workspacePaneTabTargetForBranch(repoId, branchName, workspacePanePreferenceTargetOptions)
  if (target && target.worktreePath !== worktreePath) return true
  const openStaticWorktreeTabs = new Set(
    (target?.tabs ?? []).flatMap((tab) => {
      if (tab.kind !== 'static') return []
      const provider = workspacePaneTabProvider(tab.type)
      return provider.scope === 'worktree' ? [tab.type] : []
    }),
  )
  const closeContext = readWorkspacePaneRuntimeTabCloseContext()
  const runtimeCloseTarget = {
    repoRoot: repoId,
    branchName,
    worktreePath,
  }
  const closeInput = {
    repoId,
    branchName,
    closeStaticTab: closeStaticTabWithCommit(worktreePath),
  }
  const worktreeProviders = workspacePaneTabProviders.filter((provider) => provider.scope === 'worktree')
  try {
    const results = await Promise.all(
      worktreeProviders.map((provider) => {
        if (isWorkspacePaneStaticTabProvider(provider) && !openStaticWorktreeTabs.has(provider.type)) return true
        if (!isWorkspacePaneStaticTabProvider(provider)) {
          return closeWorkspacePaneRuntimeTabsForWorktree(provider.type, runtimeCloseTarget, closeContext)
        }
        return provider.closeWorktree(closeInput)
      }),
    )
    return results.every(Boolean)
  } catch {
    return false
  }
}

function closeStaticTabWithCommit(worktreePath: string | null) {
  return async (repoId: string, type: WorkspacePaneStaticTabType, branchName: string): Promise<boolean> => {
    const repo = useReposStore.getState().repos[repoId]
    if (!repo) return false
    const result = await updateWorkspacePaneTabs({
      repoRoot: repoId,
      repoInstanceId: repo.instanceId,
      branchName,
      worktreePath,
      operation: { type: 'close-static', tabType: type },
    })
    return result.ok
  }
}
