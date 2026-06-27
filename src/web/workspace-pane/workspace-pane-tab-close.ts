import { worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  createRepoWorkspaceTabModel,
  type RepoWorkspaceTab,
  type RepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/tab-model.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  isWorkspacePaneStaticTabProvider,
  workspacePaneTabProvider,
  workspacePaneTabProviders,
} from '#/web/components/workspace-pane/tab-providers.ts'

interface CloseWorkspacePaneTabsForWorktreeOptions {
  repoId: string
  branchName: string
  worktreePath: string
}

export async function closeWorkspacePaneTab(target: RepoWorkspaceTabModel, tab: RepoWorkspaceTab): Promise<boolean> {
  if (tab.kind === 'pending') return false
  const provider = workspacePaneTabProvider(tab.type)
  const bridge = readTerminalSessionCommandBridge()
  return await provider.close({
    repoId: target.repoId,
    branchName: target.branchName,
    terminalKey: tab.kind === 'terminal' ? tab.key : undefined,
    terminalBase: target.terminalBase,
    closeStaticTab: useReposStore.getState().closeWorkspacePaneStaticTab,
    closeTerminalByDescriptor: bridge?.closeTerminalByDescriptor,
    closeTerminalsForWorktree: bridge?.closeTerminalsForWorktree,
  })
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

export function workspacePaneTabTargetForBranch(repoId: string, branchName: string): RepoWorkspaceTabModel | null {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return null
  const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  const worktreePath = branch.worktree?.path
  const terminalSyncReady = useRepoSyncStore.getState().ready.get(repoId) === repo.instanceToken
  const worktreeKey = worktreePath ? worktreeTerminalKey(repo.id, worktreePath) : null
  const snapshot = worktreeKey ? (readTerminalSessionCommandBridge()?.worktreeSnapshot(worktreeKey) ?? null) : null
  return createRepoWorkspaceTabModel({
    repoId,
    branchName,
    worktreePath: worktreePath ?? null,
    preferredTab: preferredWorkspacePaneTabForBranch(repo.ui, branchName),
    tabOrder: workspacePaneTabOrderForBranch(repo.ui, branchName),
    runtimeTerminalViews: snapshot?.sessions ?? [],
    terminalSessionCount: snapshot?.count ?? 0,
    terminalCreatePending: snapshot?.pendingCreate ?? false,
    terminalSyncReady,
    lastClosedTabContext: repo.ui.lastClosedTabContextByBranch[branchName] ?? null,
    selectedTerminalKey: worktreeKey ? (state.selectedTerminalSessionByWorktree[worktreeKey] ?? null) : null,
  })
}
