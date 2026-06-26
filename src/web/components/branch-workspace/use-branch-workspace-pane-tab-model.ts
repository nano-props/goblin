import { useEffect, useMemo } from 'react'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import {
  createBranchWorkspacePaneTabModel,
  type BranchWorkspacePaneTabModel,
  type BranchWorkspacePaneTabModelInput,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-slot-store.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneViewForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'

export interface BranchWorkspacePaneTabModelInputState {
  input: BranchWorkspacePaneTabModelInput
  selectedTerminalKey: string | undefined
}

export function useBranchWorkspacePaneTabModel(
  repo: Pick<BranchWorkspaceRepo, 'id' | 'ui'>,
  detail: SelectedBranchWorkspacePresentation,
) {
  const { input, selectedTerminalKey } = useBranchWorkspacePaneTabModelInput(repo, detail)
  const model = useMemo(() => createBranchWorkspacePaneTabModel(input), [input])
  useSyncBranchWorkspacePaneTerminalSelection(model, selectedTerminalKey)
  return model
}

/**
 * Reads repo and terminal-runtime state and packages the pure tab-model input.
 * No writes happen here; this is the data boundary into the workspace pane tab
 * projection.
 */
export function useBranchWorkspacePaneTabModelInput(
  repo: Pick<BranchWorkspaceRepo, 'id' | 'ui'>,
  detail: SelectedBranchWorkspacePresentation,
): BranchWorkspacePaneTabModelInputState {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const terminalWorktreeKey = worktreePath ? worktreeTerminalKey(repo.id, worktreePath) : null

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const selectedTerminalKey = useReposStore((s) =>
    terminalWorktreeKey ? s.selectedTerminalByWorktree[terminalWorktreeKey] : undefined,
  )

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

  const input = useMemo<BranchWorkspacePaneTabModelInput>(
    () => ({
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

  return useMemo(() => ({ input, selectedTerminalKey }), [input, selectedTerminalKey])
}

/**
 * Mirrors the model's resolved active terminal into the repos store. Keeping
 * this separate from input collection makes the single write-side effect in
 * the tab-model hook explicit.
 */
export function useSyncBranchWorkspacePaneTerminalSelection(
  model: Pick<BranchWorkspacePaneTabModel, 'activeTab' | 'worktreeTerminalKey'>,
  selectedTerminalKey: string | undefined,
): void {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const activeTerminalKey = model.activeTab?.kind === 'terminal' ? model.activeTab.key : null

  useEffect(() => {
    if (!model.worktreeTerminalKey || !activeTerminalKey) return
    if (activeTerminalKey === selectedTerminalKey) return
    setSelectedTerminal(model.worktreeTerminalKey, activeTerminalKey)
  }, [activeTerminalKey, model.worktreeTerminalKey, selectedTerminalKey, setSelectedTerminal])
}
