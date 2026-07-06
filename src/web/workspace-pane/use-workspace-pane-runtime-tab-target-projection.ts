import { useMemo } from 'react'
import {
  useTerminalRepoProjectionHydrationEntry,
  useTerminalSessionSummaries,
  useTerminalWorktreeCreatePending,
} from '#/web/components/terminal/terminal-session-store.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  type WorkspacePaneRuntimeTabTargetProjection,
  type WorkspacePaneRuntimeTabTargetSelectionByType,
  workspacePaneRuntimeTabTargetProjection,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-target-projection.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'

export interface UseWorkspacePaneRuntimeTabTargetProjectionInput {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
}

export interface WorkspacePaneRuntimeTabTargetProjectionHookResult
  extends WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabTargetKey: string | null
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
}

export function useWorkspacePaneRuntimeTabTargetProjection({
  repoRoot,
  repoInstanceId,
  worktreePath,
}: UseWorkspacePaneRuntimeTabTargetProjectionInput): WorkspacePaneRuntimeTabTargetProjectionHookResult {
  const runtimeTabTargetKey = workspacePaneRuntimeTabTargetKey({ repoRoot, worktreePath })

  const terminalSessionSummaries = useTerminalSessionSummaries(runtimeTabTargetKey)
  const terminalCreatePending = useTerminalWorktreeCreatePending(runtimeTabTargetKey)
  const terminalProjectionHydration = useTerminalRepoProjectionHydrationEntry(repoRoot)
  const selectedTerminalSessionId = useReposStore((s) =>
    runtimeTabTargetKey ? s.selectedTerminalSessionIdByTerminalWorktree[runtimeTabTargetKey] : undefined,
  )

  const selectedSessionIdByRuntimeType = useMemo<WorkspacePaneRuntimeTabTargetSelectionByType>(
    () => ({
      terminal: runtimeTabTargetKey ? (selectedTerminalSessionId ?? null) : null,
    }),
    [runtimeTabTargetKey, selectedTerminalSessionId],
  )

  const projection = useMemo(
    () =>
      workspacePaneRuntimeTabTargetProjection({
        repoRoot,
        repoInstanceId,
        worktreePath,
        selectedSessionIdByRuntimeType,
        terminal: {
          views: terminalSessionSummaries,
          createPending: terminalCreatePending,
          projectionState: {
            phase: terminalProjectionHydration.phase,
            errorMessage: terminalProjectionHydration.errorMessage,
          },
        },
      }),
    [
      repoRoot,
      repoInstanceId,
      worktreePath,
      selectedSessionIdByRuntimeType,
      terminalSessionSummaries,
      terminalCreatePending,
      terminalProjectionHydration.phase,
      terminalProjectionHydration.errorMessage,
    ],
  )

  return useMemo(
    () => ({
      ...projection,
      runtimeTabTargetKey,
      selectedSessionIdByRuntimeType,
    }),
    [projection, runtimeTabTargetKey, selectedSessionIdByRuntimeType],
  )
}
