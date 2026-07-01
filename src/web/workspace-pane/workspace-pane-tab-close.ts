import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { RepoWorkspaceTab, RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  isWorkspacePaneStaticTabProvider,
  workspacePaneTabProvider,
  workspacePaneTabProviders,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { updateWorkspacePaneTabs } from '#/web/workspace-pane/workspace-pane-tabs-commit.ts'

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
  const bridge = readTerminalSessionCommandBridge()
  if (tab.kind === 'static' && !target.branchName) return { accepted: false, completion: null }
  if (tab.kind === 'terminal' && (!target.terminalBase || !bridge?.closeTerminalByDescriptor)) {
    return { accepted: false, completion: null }
  }
  return {
    accepted: true,
    completion: provider.close({
      repoId: target.repoId,
      branchName: target.branchName,
      terminalSessionId: tab.kind === 'terminal' ? tab.terminalSessionId : undefined,
      terminalBase: target.terminalBase,
      closeStaticTab: closeStaticTabWithCommit(target.worktreePath),
      closeTerminalByDescriptor: bridge?.closeTerminalByDescriptor,
      closeTerminalsForWorktree: bridge?.closeTerminalsForWorktree,
    }),
  }
}

export async function closeWorkspacePaneTabsForWorktree({
  repoId,
  branchName,
  worktreePath,
}: CloseWorkspacePaneTabsForWorktreeOptions): Promise<boolean> {
  const target = workspacePaneTabTargetForBranch(repoId, branchName)
  if (target && target.worktreePath !== worktreePath) return true
  const terminalBase = target?.terminalBase ?? { repoRoot: repoId, branch: branchName, worktreePath }
  const openStaticWorktreeTabs = new Set(
    (target?.tabs ?? []).flatMap((tab) => {
      if (tab.kind !== 'static') return []
      const provider = workspacePaneTabProvider(tab.type)
      return provider.scope === 'worktree' ? [tab.type] : []
    }),
  )
  const bridge = readTerminalSessionCommandBridge()
  const closeInput = {
    repoId,
    branchName,
    terminalBase,
    closeStaticTab: closeStaticTabWithCommit(worktreePath),
    closeTerminalByDescriptor: bridge?.closeTerminalByDescriptor,
    closeTerminalsForWorktree: bridge?.closeTerminalsForWorktree,
  }
  const worktreeProviders = workspacePaneTabProviders.filter((provider) => provider.scope === 'worktree')
  try {
    const results = await Promise.all(
      worktreeProviders.map((provider) => {
        if (isWorkspacePaneStaticTabProvider(provider) && !openStaticWorktreeTabs.has(provider.type)) return true
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
    return await updateWorkspacePaneTabs({
      repoRoot: repoId,
      branchName,
      worktreePath,
      operation: { type: 'close-static', tabType: type },
    })
  }
}
