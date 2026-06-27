import { useEffect, useMemo } from 'react'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import {
  createRepoWorkspaceTabModel,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/components/repo-workspace/tab-model.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { workspacePaneTabOrderForBranch } from '#/web/stores/repos/workspace-pane-tabs.ts'

export interface RepoWorkspaceTabModelInputState {
  input: RepoWorkspaceTabModelInput
  selectedTerminalKey: string | undefined
}

export function useRepoWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'ui'>,
  detail: SelectedRepoWorkspacePresentation,
) {
  const { input, selectedTerminalKey } = useRepoWorkspaceTabModelInput(repo, detail)
  const model = useMemo(() => createRepoWorkspaceTabModel(input), [input])
  useSyncRepoWorkspaceTerminalSelection(model, selectedTerminalKey)
  return model
}

/**
 * Reads repo and terminal-runtime state and packages the pure tab-model input.
 * No writes happen here; this is the data boundary into the workspace pane tab
 * projection.
 */
export function useRepoWorkspaceTabModelInput(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'ui'>,
  detail: SelectedRepoWorkspacePresentation,
): RepoWorkspaceTabModelInputState {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const terminalWorktreeKey = worktreePath ? worktreeTerminalKey(repo.id, worktreePath) : null

  const worktreeSnapshot = useWorktreeTerminalSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const selectedTerminalKey = useReposStore((s) =>
    terminalWorktreeKey ? s.selectedTerminalSessionByWorktree[terminalWorktreeKey] : undefined,
  )

  const workspacePaneTabOrder = useMemo(
    () => workspacePaneTabOrderForBranch(repo.ui, branchName),
    [repo.ui.workspacePaneTabOrderByBranch, branchName],
  )

  const lastClosedTabContext = useMemo(
    () => (branchName ? (repo.ui.lastClosedTabContextByBranch[branchName] ?? null) : null),
    [branchName, repo.ui.lastClosedTabContextByBranch],
  )

  const preferredTab = useMemo(
    () => preferredWorkspacePaneTabForBranch(repo.ui, branchName),
    [repo.ui.preferredWorkspacePaneTabByBranch, branchName],
  )

  const modelSelectedTerminalKey = terminalWorktreeKey ? (selectedTerminalKey ?? null) : null

  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      repoId: repo.id,
      branchName,
      worktreePath,
      preferredTab,
      tabOrder: workspacePaneTabOrder,
      runtimeTerminalViews: worktreeSnapshot.sessions,
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
      preferredTab,
      workspacePaneTabOrder,
      worktreeSnapshot.sessions,
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
export function useSyncRepoWorkspaceTerminalSelection(
  model: Pick<RepoWorkspaceTabModel, 'activeTab' | 'worktreeTerminalKey'>,
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
