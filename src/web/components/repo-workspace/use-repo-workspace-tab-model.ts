import { useEffect, useMemo } from 'react'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import {
  createRepoWorkspaceTabModel,
  type RepoWorkspaceTabModel,
  type RepoWorkspaceTabModelInput,
} from '#/web/components/repo-workspace/tab-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { formatAgentWorktreeKey } from '#/shared/agent-worktree-key.ts'
import {
  useTerminalRepoProjectionHydrationEntry,
  useTerminalSessionSummaries,
  useTerminalWorktreePendingCreate,
} from '#/web/components/terminal/terminal-session-store.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  useWorkspacePaneTabsQuery,
  workspacePaneTabsForTargetFromQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { useAgentSessionsQuery } from '#/web/agent-queries.ts'

export interface RepoWorkspaceTabModelInputState {
  input: RepoWorkspaceTabModelInput
  selectedTerminalSessionId: string | undefined
}

export function useRepoWorkspaceTabModel(
  repo: Pick<RepoWorkspaceRepo, 'id' | 'instanceId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
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
  repo: Pick<RepoWorkspaceRepo, 'id' | 'instanceId' | 'ui'>,
  detail: CurrentRepoWorkspacePresentation,
): RepoWorkspaceTabModelInputState {
  const { branch } = detail
  const branchName = branch?.name ?? null
  const worktreePath = branch?.worktree?.path ?? null
  const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repo.id, worktreePath) : null
  const agentWorktreeKey = worktreePath ? formatAgentWorktreeKey(repo.id, worktreePath) : null

  const terminalSessionSummaries = useTerminalSessionSummaries(terminalWorktreeKey)
  const agentSessionsQuery = useAgentSessionsQuery(repo.id, repo.instanceId)
  const terminalCreatePending = useTerminalWorktreePendingCreate(terminalWorktreeKey)
  const terminalProjectionHydration = useTerminalRepoProjectionHydrationEntry(repo.id)
  const terminalProjectionPhase = terminalProjectionHydration.phase
  const workspacePaneTabsQuery = useWorkspacePaneTabsQuery(repo.id, repo.instanceId)
  const selectedTerminalSessionId = useReposStore((s) =>
    terminalWorktreeKey ? s.selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] : undefined,
  )
  const selectedAgentSessionId = useReposStore((s) =>
    agentWorktreeKey ? s.selectedAgentSessionIdByAgentWorktree[agentWorktreeKey] : undefined,
  )

  const workspacePaneTabEntries = useMemo(
    () =>
      workspacePaneTabsForTargetFromQueryData(workspacePaneTabsQuery.data ?? [], {
        repoRoot: repo.id,
        branchName,
        worktreePath,
      }),
    [workspacePaneTabsQuery.data, repo.id, repo.instanceId, branchName, worktreePath],
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
  const modelSelectedAgentSessionId = agentWorktreeKey ? (selectedAgentSessionId ?? null) : null

  const input = useMemo<RepoWorkspaceTabModelInput>(
    () => ({
      repoId: repo.id,
      repoInstanceId: repo.instanceId,
      branchName,
      worktreePath,
      preferredTab,
      tabEntries: workspacePaneTabEntries,
      runtimeTerminalViews: terminalSessionSummaries,
      runtimeAgentViews: agentSessionsQuery.data ?? [],
      terminalCreatePending,
      terminalProjectionPhase,
      terminalProjectionErrorMessage: terminalProjectionHydration.errorMessage,
      selectedTerminalSessionId: modelSelectedTerminalSessionId,
      selectedAgentSessionId: modelSelectedAgentSessionId,
    }),
    [
      repo.id,
      repo.instanceId,
      branchName,
      worktreePath,
      preferredTab,
      workspacePaneTabEntries,
      terminalSessionSummaries,
      agentSessionsQuery.data,
      terminalCreatePending,
      terminalProjectionPhase,
      terminalProjectionHydration.errorMessage,
      modelSelectedTerminalSessionId,
      modelSelectedAgentSessionId,
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
  model: Pick<RepoWorkspaceTabModel, 'activeTab' | 'terminalWorktreeKey' | 'agentWorktreeKey'>,
  selectedTerminalSessionId: string | undefined,
): void {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const setSelectedAgent = useReposStore((s) => s.setSelectedAgent)
  const activeTerminalSessionId = model.activeTab?.kind === 'terminal' ? model.activeTab.terminalSessionId : null
  const activeAgentSessionId = model.activeTab?.kind === 'agent' ? model.activeTab.agentSessionId : null

  useEffect(() => {
    if (!model.terminalWorktreeKey || !activeTerminalSessionId) return
    if (activeTerminalSessionId === selectedTerminalSessionId) return
    setSelectedTerminal(model.terminalWorktreeKey, activeTerminalSessionId)
  }, [activeTerminalSessionId, model.terminalWorktreeKey, selectedTerminalSessionId, setSelectedTerminal])

  useEffect(() => {
    if (!model.agentWorktreeKey || !activeAgentSessionId) return
    setSelectedAgent(model.agentWorktreeKey, activeAgentSessionId)
  }, [activeAgentSessionId, model.agentWorktreeKey, setSelectedAgent])
}
