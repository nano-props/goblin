import { useEffect, useMemo } from 'react'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  useTerminalRepoProjectionHydrationEntry,
  useTerminalSessionSummaries,
  useTerminalWorktreeCreatePending,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceRuntimeTabStateInput } from '#/web/components/repo-workspace/tab-model.ts'
import type { WorkspacePaneRuntimeProjectionState } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

export type WorkspacePaneRuntimeTabTargetSelectionByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>
export type WorkspacePaneRuntimeTabTargetKeyByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>

export interface WorkspacePaneRuntimeTabTargetInput {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
}

export interface WorkspacePaneRuntimeTabProviderProjection {
  type: WorkspacePaneRuntimeTabType
  targetKey: string | null
  views: readonly WorkspacePaneRuntimeTabSummary[]
  state: RepoWorkspaceRuntimeTabStateInput
  selectedSessionId: string | null
}

export function workspacePaneRuntimeTabTargetKeyForType(
  type: WorkspacePaneRuntimeTabType,
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>,
): string | null {
  switch (type) {
    case 'terminal':
      return terminalRuntimeTabTargetKey(input)
  }
}

export function workspacePaneRuntimeTabTargetKeyByType(
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>,
): WorkspacePaneRuntimeTabTargetKeyByType {
  return {
    terminal: workspacePaneRuntimeTabTargetKeyForType('terminal', input),
  }
}

export function readWorkspacePaneRuntimeTabProviderProjections(input: {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
  selectedSessionIdByRuntimeType?: WorkspacePaneRuntimeTabTargetSelectionByType
}): WorkspacePaneRuntimeTabProviderProjection[] {
  return [readTerminalRuntimeTabProviderProjection(input)]
}

export function useWorkspacePaneRuntimeTabProviderProjections(
  input: WorkspacePaneRuntimeTabTargetInput,
): WorkspacePaneRuntimeTabProviderProjection[] {
  const terminal = useTerminalRuntimeTabProviderProjection(input)
  return useMemo(() => [terminal], [terminal])
}

export function useSyncWorkspacePaneRuntimeTabProviderSelection(
  input: {
    activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
    runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  },
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType,
): void {
  useSyncTerminalRuntimeTabSelection(input, selectedSessionIdByRuntimeType)
}

function terminalRuntimeTabTargetKey(
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>,
): string | null {
  return input.worktreePath ? formatTerminalWorktreeKey(input.repoRoot, input.worktreePath) : null
}

function readTerminalRuntimeTabProviderProjection(input: {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
  selectedSessionIdByRuntimeType?: WorkspacePaneRuntimeTabTargetSelectionByType
}): WorkspacePaneRuntimeTabProviderProjection {
  const targetKey = terminalRuntimeTabTargetKey(input)
  const snapshot = targetKey ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(targetKey) ?? null) : null
  const selectedSessionId = targetKey ? (input.selectedSessionIdByRuntimeType?.terminal ?? null) : null
  const projectionState = readTerminalRuntimeProjectionState(input.repoRoot, input.repoInstanceId)
  return {
    type: 'terminal',
    targetKey,
    views: targetKey ? (snapshot?.sessions ?? []) : [],
    selectedSessionId,
    state: {
      createPending: snapshot?.createPending ?? false,
      projectionPhase: projectionState.phase,
      projectionErrorMessage: projectionState.errorMessage,
      selectedSessionId,
    },
  }
}

function useTerminalRuntimeTabProviderProjection({
  repoRoot,
  repoInstanceId,
  worktreePath,
}: WorkspacePaneRuntimeTabTargetInput): WorkspacePaneRuntimeTabProviderProjection {
  const targetKey = terminalRuntimeTabTargetKey({ repoRoot, worktreePath })
  const terminalSessionSummaries = useTerminalSessionSummaries(targetKey)
  const terminalCreatePending = useTerminalWorktreeCreatePending(targetKey)
  const terminalProjectionHydration = useTerminalRepoProjectionHydrationEntry(repoRoot)
  const selectedTerminalSessionId = useReposStore((s) =>
    targetKey ? s.selectedTerminalSessionIdByTerminalWorktree[targetKey] : undefined,
  )

  return useMemo(() => {
    const selectedSessionId = targetKey ? (selectedTerminalSessionId ?? null) : null
    const currentHydration =
      terminalProjectionHydration.instanceId === repoInstanceId ? terminalProjectionHydration : null
    return {
      type: 'terminal',
      targetKey,
      views: targetKey ? terminalSessionSummaries : [],
      selectedSessionId,
      state: {
        createPending: terminalCreatePending,
        projectionPhase: currentHydration?.phase ?? 'pending',
        projectionErrorMessage: currentHydration?.errorMessage,
        selectedSessionId,
      },
    }
  }, [
    repoInstanceId,
    selectedTerminalSessionId,
    targetKey,
    terminalCreatePending,
    terminalProjectionHydration,
    terminalSessionSummaries,
  ])
}

function useSyncTerminalRuntimeTabSelection(
  input: {
    activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
    runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  },
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType,
): void {
  const setSelectedTerminal = useReposStore((s) => s.setSelectedTerminal)
  const activeTerminalSessionId = input.activeSessionIdByRuntimeType.terminal ?? null
  const selectedTerminalSessionId = selectedSessionIdByRuntimeType.terminal ?? undefined
  const terminalTargetKey = input.runtimeTabTargetKeyByType.terminal ?? null

  useEffect(() => {
    if (!terminalTargetKey || !activeTerminalSessionId) return
    if (activeTerminalSessionId === selectedTerminalSessionId) return
    setSelectedTerminal(terminalTargetKey, activeTerminalSessionId)
  }, [activeTerminalSessionId, selectedTerminalSessionId, setSelectedTerminal, terminalTargetKey])
}

function readTerminalRuntimeProjectionState(
  repoRoot: string,
  repoInstanceId: string,
): WorkspacePaneRuntimeProjectionState {
  const terminalProjectionHydration = useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(repoRoot)
  const currentTerminalProjectionHydration =
    terminalProjectionHydration?.instanceId === repoInstanceId ? terminalProjectionHydration : null
  return {
    phase: currentTerminalProjectionHydration?.phase ?? 'pending',
    errorMessage: currentTerminalProjectionHydration?.errorMessage,
  }
}
