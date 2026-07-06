import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { RepoWorkspaceRuntimeTabStateInput } from '#/web/components/repo-workspace/tab-model.ts'
import type {
  WorkspacePaneTabSummary,
  WorkspacePaneTerminalTabSummary,
} from '#/web/components/workspace-pane/workspace-pane-tab-summary.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { WorkspacePaneRuntimeProjectionState } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import { workspacePaneRuntimeTabTargetKey } from '#/web/workspace-pane/workspace-pane-runtime-tab-target-key.ts'

export type WorkspacePaneRuntimeTabTargetSelectionByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>

export interface WorkspacePaneRuntimeTabTargetProjection {
  runtimeTabViews: WorkspacePaneTabSummary[]
  runtimeTabStateByType: Record<WorkspacePaneRuntimeTabType, RepoWorkspaceRuntimeTabStateInput>
}

export interface WorkspacePaneRuntimeTabTargetProjectionInput {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
  selectedSessionIdByRuntimeType?: WorkspacePaneRuntimeTabTargetSelectionByType
  terminal?: {
    views?: readonly WorkspacePaneTerminalTabSummary[]
    createPending?: boolean
    projectionState?: WorkspacePaneRuntimeProjectionState
  }
}

export function readWorkspacePaneRuntimeTabTargetProjection(input: {
  repoRoot: string
  repoInstanceId: string
  worktreePath: string | null
  selectedSessionIdByRuntimeType?: WorkspacePaneRuntimeTabTargetSelectionByType
}): WorkspacePaneRuntimeTabTargetProjection {
  const runtimeTargetKey = workspacePaneRuntimeTabTargetKey({
    repoRoot: input.repoRoot,
    worktreePath: input.worktreePath,
  })
  const snapshot = runtimeTargetKey
    ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(runtimeTargetKey) ?? null)
    : null
  return workspacePaneRuntimeTabTargetProjection({
    repoRoot: input.repoRoot,
    repoInstanceId: input.repoInstanceId,
    worktreePath: input.worktreePath,
    selectedSessionIdByRuntimeType: input.selectedSessionIdByRuntimeType,
    terminal: {
      views: snapshot?.sessions ?? [],
      createPending: snapshot?.pendingCreate ?? false,
      projectionState: readTerminalRuntimeProjectionState(input.repoRoot, input.repoInstanceId),
    },
  })
}

export function workspacePaneRuntimeTabTargetProjection(
  input: WorkspacePaneRuntimeTabTargetProjectionInput,
): WorkspacePaneRuntimeTabTargetProjection {
  const hasRuntimeTarget = !!input.worktreePath
  const terminalProjectionState = input.terminal?.projectionState ?? { phase: 'pending' }
  return {
    runtimeTabViews: hasRuntimeTarget ? [...(input.terminal?.views ?? [])] : [],
    runtimeTabStateByType: {
      terminal: {
        createPending: input.terminal?.createPending ?? false,
        projectionPhase: terminalProjectionState.phase,
        projectionErrorMessage: terminalProjectionState.errorMessage,
        selectedSessionId: hasRuntimeTarget ? (input.selectedSessionIdByRuntimeType?.terminal ?? null) : null,
      },
    },
  }
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
