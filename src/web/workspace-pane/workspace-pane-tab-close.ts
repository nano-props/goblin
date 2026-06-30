import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { RepoWorkspaceTab, RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  isWorkspacePaneStaticTabProvider,
  workspacePaneTabProvider,
  workspacePaneTabProviders,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'

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
      terminalKey: tab.kind === 'terminal' ? tab.terminalKey : undefined,
      terminalBase: target.terminalBase,
      closeStaticTab: useReposStore.getState().closeWorkspacePaneStaticTab,
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
    closeStaticTab: useReposStore.getState().closeWorkspacePaneStaticTab,
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
