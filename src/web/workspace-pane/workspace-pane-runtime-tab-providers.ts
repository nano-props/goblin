import { useEffect, useMemo } from 'react'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  useTerminalRepoProjectionHydrationEntry,
  useTerminalSessionSummaries,
  useTerminalWorktreeCreatePending,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceRuntimeTabStateInput } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import type { WorkspacePaneRuntimeProjectionState } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

export type WorkspacePaneRuntimeTabTargetSelectionByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>
export type WorkspacePaneRuntimeTabTargetKeyByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>

export interface WorkspacePaneRuntimeTabTargetInput {
  repoRoot: string
  repoRuntimeId: string
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
  targetKey: (input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>) => string | null
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
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>,
): string | null {
  return workspacePaneRuntimeTabProjectionProvider(type).targetKey(input)
}

export function workspacePaneRuntimeTabTargetKeyByType(
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>,
): WorkspacePaneRuntimeTabTargetKeyByType {
  return Object.fromEntries(
    workspacePaneRuntimeTabProjectionProviders().map((provider) => [provider.type, provider.targetKey(input)]),
  ) as WorkspacePaneRuntimeTabTargetKeyByType
}

export function readWorkspacePaneRuntimeTabProviderProjections(input: {
  repoRoot: string
  repoRuntimeId: string
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
  input: Pick<WorkspacePaneRuntimeTabTargetInput, 'repoRoot' | 'worktreePath'>,
): string | null {
  return input.worktreePath ? formatTerminalWorktreeKey(input.repoRoot, input.worktreePath) : null
}

function readTerminalRuntimeTabProviderProjection(input: {
  repoRoot: string
  repoRuntimeId: string
  worktreePath: string | null
}): WorkspacePaneRuntimeTabProviderProjection {
  const targetKey = terminalRuntimeTabTargetKey(input)
  const snapshot = targetKey ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(targetKey) ?? null) : null
  const selectedSessionId = targetKey ? readTerminalSelectedSessionId(targetKey) : null
  const projectionState = readTerminalRuntimeProjectionState(input.repoRoot, input.repoRuntimeId)
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
  return useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null
}

function useTerminalRuntimeTabProviderProjection({
  repoRoot,
  repoRuntimeId,
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
      terminalProjectionHydration.repoRuntimeId === repoRuntimeId ? terminalProjectionHydration : null
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
    repoRuntimeId,
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
  repoRuntimeId: string,
): WorkspacePaneRuntimeProjectionState {
  const terminalProjectionHydration = useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(repoRoot)
  const currentTerminalProjectionHydration =
    terminalProjectionHydration?.repoRuntimeId === repoRuntimeId ? terminalProjectionHydration : null
  return {
    phase: currentTerminalProjectionHydration?.phase ?? 'pending',
    errorMessage: currentTerminalProjectionHydration?.errorMessage,
  }
}
