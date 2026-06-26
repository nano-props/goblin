import { useEffect, useMemo } from 'react'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { createBranchWorkspacePaneTabModel } from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-slot-store.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'

/**
 * Builds the workspace pane tab model and keeps the per-worktree terminal
 * selection in the repos store in sync with the model's resolved active tab.
 *
 * This makes the workspace pane tab model the single authority for which
 * workspace tab is active: the model reads `selectedTerminalByWorktree`,
 * resolves the active terminal tab, and writes the key back only when the
 * model resolves a different terminal than the one already recorded.
 */
export function useBranchWorkspacePaneTabModel(
  repo: Pick<BranchWorkspaceRepo, 'id' | 'ui'>,
  detail: SelectedBranchWorkspacePresentation,
) {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const terminalWorktreeKey = worktreePath ? worktreeTerminalKey(repo.id, worktreePath) : null

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const selectedTerminalKey = useReposStore((s) =>
    terminalWorktreeKey ? s.selectedTerminalByWorktree[terminalWorktreeKey] : undefined,
  )
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)

  const workspacePaneTabOrder = useMemo(
    () => workspacePaneTabOrderForBranch(repo.ui, branchName),
    [repo.ui.workspacePaneTabOrderByBranch, branchName],
  )

  const lastClosedTabContext = useMemo(
    () => (branchName ? (repo.ui.lastClosedTabContextByBranch[branchName] ?? null) : null),
    [branchName, repo.ui.lastClosedTabContextByBranch],
  )

  const preferredView = useMemo(
    () => preferredWorkspacePaneViewForBranch(repo.ui, branchName),
    [repo.ui.preferredWorkspacePaneViewByBranch, branchName],
  )

  const modelSelectedTerminalKey = terminalWorktreeKey ? (selectedTerminalKey ?? null) : null

  const model = useMemo(
    () =>
      createBranchWorkspacePaneTabModel({
        repoId: repo.id,
        branchName,
        worktreePath,
        preferredView,
        tabOrder: workspacePaneTabOrder,
        runtimeTerminalViews: worktreeSnapshot.slots,
        terminalSessionCount: worktreeSnapshot.count,
        terminalCreatePending: worktreeSnapshot.pendingCreate,
        terminalSyncReady,
        lastClosedTabContext,
        selectedTerminalKey: modelSelectedTerminalKey,
      }),
    [
      repo.id,
      branchName,
      worktreePath,
      preferredView,
      workspacePaneTabOrder,
      worktreeSnapshot.slots,
      worktreeSnapshot.count,
      worktreeSnapshot.pendingCreate,
      terminalSyncReady,
      lastClosedTabContext,
      modelSelectedTerminalKey,
    ],
  )

  useEffect(() => {
    if (!terminalWorktreeKey) return
    const activeTab = model.activeTab
    if (activeTab?.kind !== 'terminal') return
    if (activeTab.key === selectedTerminalKey) return
    setSelectedTerminal(terminalWorktreeKey, activeTab.key)
  }, [terminalWorktreeKey, model.activeTab, selectedTerminalKey, setSelectedTerminal])

  return model
}
