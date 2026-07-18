import { useEffect, useMemo } from 'react'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { canonicalWorkspaceLocator, workspaceLocatorForPath } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  useTerminalRepoProjectionHydrationEntry,
  useTerminalSessionSummaries,
  useTerminalWorktreeCreatePending,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { RepoWorkspaceRuntimeTabStateInput } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { WorkspacePaneRuntimeProjectionState } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

export type WorkspacePaneRuntimeTabTargetSelectionByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>
export type WorkspacePaneRuntimeTabTargetKeyByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>

export interface WorkspacePaneRuntimeTabTargetInput {
  workspaceId: string
  workspaceRuntimeId: string
  worktreePath: string | null
}

export interface WorkspacePaneRuntimeTabProviderProjection {
  type: WorkspacePaneRuntimeTabType
  targetKey: string | null
  views: readonly WorkspacePaneRuntimeTabSummary[]
  state: RepoWorkspaceRuntimeTabStateInput
  selectedSessionId: string | null
}

interface WorkspacePaneRuntimeTabSelectionSyncInput {
  activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
}

export interface WorkspacePaneRuntimeTabProjectionProvider {
  type: WorkspacePaneRuntimeTabType
  targetKey: (input: Pick<WorkspacePaneRuntimeTabTargetInput, 'workspaceId' | 'worktreePath'>) => string | null
  readProjection: (input: WorkspacePaneRuntimeTabTargetInput) => WorkspacePaneRuntimeTabProviderProjection
  useProjection: (input: WorkspacePaneRuntimeTabTargetInput) => WorkspacePaneRuntimeTabProviderProjection
  useSyncSelection: (
    input: WorkspacePaneRuntimeTabSelectionSyncInput,
    selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType,
  ) => void
}

const terminalRuntimeTabProjectionProvider = {
  type: 'terminal',
  targetKey: terminalRuntimeTabTargetKey,
  readProjection: readTerminalRuntimeTabProviderProjection,
  useProjection: useTerminalRuntimeTabProviderProjection,
  useSyncSelection: useSyncTerminalRuntimeTabSelection,
} satisfies WorkspacePaneRuntimeTabProjectionProvider

// Runtime tab types are registered explicitly so adding a new server-owned
// session tab type requires a compile-time update instead of hidden fallback
// behavior in the generic tab strip.
const WORKSPACE_PANE_RUNTIME_TAB_PROJECTION_PROVIDERS = [
  terminalRuntimeTabProjectionProvider,
] as const satisfies readonly WorkspacePaneRuntimeTabProjectionProvider[]

const WORKSPACE_PANE_RUNTIME_TAB_PROJECTION_PROVIDER_BY_TYPE = {
  terminal: terminalRuntimeTabProjectionProvider,
} as const satisfies Record<WorkspacePaneRuntimeTabType, WorkspacePaneRuntimeTabProjectionProvider>

export function workspacePaneRuntimeTabProjectionProviders(): readonly WorkspacePaneRuntimeTabProjectionProvider[] {
  return WORKSPACE_PANE_RUNTIME_TAB_PROJECTION_PROVIDERS
}

export function workspacePaneRuntimeTabProjectionProvider(
  type: WorkspacePaneRuntimeTabType,
): WorkspacePaneRuntimeTabProjectionProvider {
  return WORKSPACE_PANE_RUNTIME_TAB_PROJECTION_PROVIDER_BY_TYPE[type]
}

export function workspacePaneRuntimeTabTargetKeyForType(
  type: WorkspacePaneRuntimeTabType,
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'workspaceId' | 'worktreePath'>,
): string | null {
  return workspacePaneRuntimeTabProjectionProvider(type).targetKey(input)
}

export function workspacePaneRuntimeTabTargetKeyByType(
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'workspaceId' | 'worktreePath'>,
): WorkspacePaneRuntimeTabTargetKeyByType {
  return Object.fromEntries(
    workspacePaneRuntimeTabProjectionProviders().map((provider) => [provider.type, provider.targetKey(input)]),
  ) as WorkspacePaneRuntimeTabTargetKeyByType
}

export function readWorkspacePaneRuntimeTabProviderProjections(input: {
  workspaceId: string
  workspaceRuntimeId: string
  worktreePath: string | null
}): WorkspacePaneRuntimeTabProviderProjection[] {
  return workspacePaneRuntimeTabProjectionProviders().map((provider) => provider.readProjection(input))
}

export function useWorkspacePaneRuntimeTabProviderProjections(
  input: WorkspacePaneRuntimeTabTargetInput,
): WorkspacePaneRuntimeTabProviderProjection[] {
  // Hook calls stay explicit so adding a runtime type requires a deliberate
  // compile-time update without making hook order depend on a dynamic loop.
  const terminal = workspacePaneRuntimeTabProjectionProvider('terminal').useProjection(input)
  return useMemo(() => [terminal], [terminal])
}

export function useSyncWorkspacePaneRuntimeTabProviderSelection(
  input: {
    activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
    runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  },
  selectedSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType,
): void {
  workspacePaneRuntimeTabProjectionProvider('terminal').useSyncSelection(input, selectedSessionIdByRuntimeType)
}

function terminalRuntimeTabTargetKey(
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'workspaceId' | 'worktreePath'>,
): string | null {
  const workspaceId = canonicalWorkspaceLocator(input.workspaceId)
  const worktreeId =
    input.worktreePath && workspaceId
      ? (canonicalWorkspaceLocator(input.worktreePath) ?? workspaceLocatorForPath(workspaceId, input.worktreePath))
      : null
  return workspaceId && worktreeId ? formatTerminalWorktreeKey(workspaceId, worktreeId) : null
}

function readTerminalRuntimeTabProviderProjection(input: {
  workspaceId: string
  workspaceRuntimeId: string
  worktreePath: string | null
}): WorkspacePaneRuntimeTabProviderProjection {
  const targetKey = terminalRuntimeTabTargetKey(input)
  const snapshot = targetKey ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(targetKey) ?? null) : null
  const selectedSessionId = targetKey ? readTerminalSelectedSessionId(targetKey) : null
  const projectionState = readTerminalRuntimeProjectionState(input.workspaceId, input.workspaceRuntimeId)
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

function readTerminalSelectedSessionId(terminalWorktreeKey: string): string | null {
  return useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null
}

function useTerminalRuntimeTabProviderProjection({
  workspaceId,
  workspaceRuntimeId,
  worktreePath,
}: WorkspacePaneRuntimeTabTargetInput): WorkspacePaneRuntimeTabProviderProjection {
  const targetKey = terminalRuntimeTabTargetKey({ workspaceId, worktreePath })
  const terminalSessionSummaries = useTerminalSessionSummaries(targetKey)
  const terminalCreatePending = useTerminalWorktreeCreatePending(targetKey)
  const terminalProjectionHydration = useTerminalRepoProjectionHydrationEntry(workspaceId)
  const selectedTerminalSessionId = useWorkspacesStore((s) =>
    targetKey ? s.selectedTerminalSessionIdByTerminalWorktree[targetKey] : undefined,
  )

  return useMemo(() => {
    const selectedSessionId = targetKey ? (selectedTerminalSessionId ?? null) : null
    const currentHydration =
      terminalProjectionHydration.workspaceRuntimeId === workspaceRuntimeId ? terminalProjectionHydration : null
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
    workspaceRuntimeId,
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
  const setSelectedTerminal = useWorkspacesStore((s) => s.setSelectedTerminal)
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
  workspaceId: string,
  workspaceRuntimeId: string,
): WorkspacePaneRuntimeProjectionState {
  const terminalProjectionHydration = useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(workspaceId)
  const currentTerminalProjectionHydration =
    terminalProjectionHydration?.workspaceRuntimeId === workspaceRuntimeId ? terminalProjectionHydration : null
  return {
    phase: currentTerminalProjectionHydration?.phase ?? 'pending',
    errorMessage: currentTerminalProjectionHydration?.errorMessage,
  }
}
