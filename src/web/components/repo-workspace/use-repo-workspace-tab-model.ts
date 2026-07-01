import { useEffect, useMemo } from 'react'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import {
  createRepoWorkspaceTabModel,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/components/repo-workspace/tab-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import {
  useTerminalRepoSyncReady,
  useTerminalWorktreeSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export interface RepoWorkspaceTabModelInputState {
  input: RepoWorkspaceTabModelInput
  selectedTerminalSessionId: string | undefined
}

export function useRepoWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'ui'>,
  detail: SelectedRepoWorkspacePresentation,
) {
  const { input, selectedTerminalSessionId } = useRepoWorkspaceTabModelInput(repo, detail)
  const model = useMemo(() => createRepoWorkspaceTabModel(input), [input])
  useSyncRepoWorkspaceTerminalSelection(model, selectedTerminalSessionId)
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
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repo.id)
  const selectedTerminalSessionId = useReposStore((s) =>
    terminalWorktreeKey ? s.selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] : undefined,
  )

  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(workspacePaneTabsQuery.data ?? [], {
        repoRoot: repo.id,
        branchName,
        worktreePath,
      }),
    [workspacePaneTabsQuery.data, repo.id, branchName, worktreePath],
  )

  const preferredTab = useMemo(
    () =>
      preferredWorkspacePaneTabForTarget(
        repo.ui,
        branchName ? { repoRoot: repo.id, branchName, worktreePath } : null,
      ),
    [repo.ui.preferredWorkspacePaneTabByTarget, repo.id, branchName, worktreePath],
  )

  const modelSelectedTerminalSessionId = terminalWorktreeKey ? (selectedTerminalSessionId ?? null) : null

  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      repoId: repo.id,
      branchName,
      worktreePath,
      preferredTab,
      tabEntries: workspacePaneTabEntries,
      runtimeTerminalViews: terminalWorktreeSnapshot.sessions,
      terminalCreatePending: terminalWorktreeSnapshot.pendingCreate,
      terminalSyncReady,
      selectedTerminalSessionId: modelSelectedTerminalSessionId,
    }),
    [
      repo.id,
      branchName,
      worktreePath,
      preferredTab,
      workspacePaneTabEntries,
      terminalWorktreeSnapshot.sessions,
      terminalWorktreeSnapshot.pendingCreate,
      terminalSyncReady,
      modelSelectedTerminalSessionId,
    ],
  )

  return useMemo(() => ({ input, selectedTerminalSessionId }), [input, selectedTerminalSessionId])
}

/**
 * Mirrors the model's resolved active terminal into the repos store. Keeping
 * this separate from input collection makes the single write-side effect in
 * the tab-model hook explicit.
 */
export function useSyncRepoWorkspaceTerminalSelection(
  model: Pick<RepoWorkspaceTabModel, 'activeTab' | 'terminalWorktreeKey'>,
  selectedTerminalSessionId: string | undefined,
): void {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const activeTerminalSessionId = model.activeTab?.kind === 'terminal' ? model.activeTab.terminalSessionId : null

  useEffect(() => {
    if (!model.terminalWorktreeKey || !activeTerminalSessionId) return
    if (activeTerminalSessionId === selectedTerminalSessionId) return
    setSelectedTerminal(model.terminalWorktreeKey, activeTerminalSessionId)
  }, [activeTerminalSessionId, model.terminalWorktreeKey, selectedTerminalSessionId, setSelectedTerminal])
}
