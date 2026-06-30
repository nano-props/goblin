import { useEffect, useMemo } from 'react'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import {
  createRepoWorkspaceTabModel,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/components/repo-workspace/tab-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-workspace-slot-key.ts'
import {
  useTerminalRepoSyncReady,
  useTerminalWorktreeSnapshot,
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
  const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repo.id, worktreePath) : null

  const terminalWorktreeSnapshot = useTerminalWorktreeSnapshot(terminalWorktreeKey)
  const terminalSyncReady = useTerminalRepoSyncReady(repo.id)
  const selectedTerminalKey = useReposStore((s) =>
    terminalWorktreeKey ? s.selectedTerminalKeyByTerminalWorktree[terminalWorktreeKey] : undefined,
  )

  const workspacePaneTabOrder = useMemo(
    () => workspacePaneTabOrderForBranch(repo.ui, branchName),
    [repo.ui.workspacePaneTabOrderByBranch, branchName],
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
      runtimeTerminalViews: terminalWorktreeSnapshot.sessions,
      terminalSessionCount: terminalWorktreeSnapshot.count,
      terminalCreatePending: terminalWorktreeSnapshot.pendingCreate,
      terminalSyncReady,
      selectedTerminalKey: modelSelectedTerminalKey,
    }),
    [
      repo.id,
      branchName,
      worktreePath,
      preferredTab,
      workspacePaneTabOrder,
      terminalWorktreeSnapshot.sessions,
      terminalWorktreeSnapshot.count,
      terminalWorktreeSnapshot.pendingCreate,
      terminalSyncReady,
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
  model: Pick<RepoWorkspaceTabModel, 'activeTab' | 'terminalWorktreeKey'>,
  selectedTerminalKey: string | undefined,
): void {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const activeTerminalKey = model.activeTab?.kind === 'terminal' ? model.activeTab.terminalKey : null

  useEffect(() => {
    if (!model.terminalWorktreeKey || !activeTerminalKey) return
    if (activeTerminalKey === selectedTerminalKey) return
    setSelectedTerminal(model.terminalWorktreeKey, activeTerminalKey)
  }, [activeTerminalKey, model.terminalWorktreeKey, selectedTerminalKey, setSelectedTerminal])
}
