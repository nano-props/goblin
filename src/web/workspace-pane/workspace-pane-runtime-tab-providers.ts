import { computed, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'
import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  useTerminalWorkspaceProjectionHydrationEntry,
  useTerminalSessionSummaries,
  useTerminalFilesystemTargetCreatePending,
} from '#/web/components/terminal/terminal-session-store.ts'
import type { WorkspacePaneRuntimeTabSummary } from '#/web/workspace-pane/workspace-pane-tab-summary.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspacePaneRuntimeTabStateInput } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import type { WorkspacePaneRuntimeProjectionState } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export type WorkspacePaneRuntimeTabTargetSelectionByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>
export type WorkspacePaneRuntimeTabTargetKeyByType = Partial<Record<WorkspacePaneRuntimeTabType, string | null>>

export interface WorkspacePaneRuntimeTabTargetInput {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  filesystemTarget: WorkspacePaneFilesystemExecutionTarget | null
}

export interface WorkspacePaneRuntimeTabProviderProjection {
  type: WorkspacePaneRuntimeTabType
  targetKey: string | null
  views: readonly WorkspacePaneRuntimeTabSummary[]
  state: WorkspacePaneRuntimeTabStateInput
  selectedSessionId: string | null
}

interface WorkspacePaneRuntimeTabSelectionSyncInput {
  activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
  runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
}

export interface WorkspacePaneRuntimeTabProjectionProvider {
  type: WorkspacePaneRuntimeTabType
  targetKey: (input: WorkspacePaneRuntimeTabTargetInput) => string | null
  readProjection: (input: WorkspacePaneRuntimeTabTargetInput) => WorkspacePaneRuntimeTabProviderProjection
  useProjection: (
    input: MaybeRefOrGetter<WorkspacePaneRuntimeTabTargetInput>,
  ) => ComputedRef<WorkspacePaneRuntimeTabProviderProjection>
  useSyncSelection: (
    input: MaybeRefOrGetter<WorkspacePaneRuntimeTabSelectionSyncInput>,
    selectedSessionIdByRuntimeType: MaybeRefOrGetter<WorkspacePaneRuntimeTabTargetSelectionByType>,
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
  input: WorkspacePaneRuntimeTabTargetInput,
): string | null {
  return workspacePaneRuntimeTabProjectionProvider(type).targetKey(input)
}

export function workspacePaneRuntimeTabTargetKeyByType(
  input: WorkspacePaneRuntimeTabTargetInput,
): WorkspacePaneRuntimeTabTargetKeyByType {
  return Object.fromEntries(
    workspacePaneRuntimeTabProjectionProviders().map((provider) => [provider.type, provider.targetKey(input)]),
  ) as WorkspacePaneRuntimeTabTargetKeyByType
}

export function readWorkspacePaneRuntimeTabProviderProjections(
  input: WorkspacePaneRuntimeTabTargetInput,
): WorkspacePaneRuntimeTabProviderProjection[] {
  return workspacePaneRuntimeTabProjectionProviders().map((provider) => provider.readProjection(input))
}

export function useWorkspacePaneRuntimeTabProviderProjections(
  input: MaybeRefOrGetter<WorkspacePaneRuntimeTabTargetInput>,
): ComputedRef<WorkspacePaneRuntimeTabProviderProjection[]> {
  // Hook calls stay explicit so adding a runtime type requires a deliberate
  // compile-time update without making hook order depend on a dynamic loop.
  const terminal = workspacePaneRuntimeTabProjectionProvider('terminal').useProjection(input)
  return computed(() => [terminal.value])
}

export function useSyncWorkspacePaneRuntimeTabProviderSelection(
  input: MaybeRefOrGetter<{
    activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
    runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  }>,
  selectedSessionIdByRuntimeType: MaybeRefOrGetter<WorkspacePaneRuntimeTabTargetSelectionByType>,
): void {
  workspacePaneRuntimeTabProjectionProvider('terminal').useSyncSelection(input, selectedSessionIdByRuntimeType)
}

function terminalRuntimeTabTargetKey(input: WorkspacePaneRuntimeTabTargetInput): string | null {
  const workspaceId = canonicalWorkspaceLocator(input.workspaceId)
  const target = input.filesystemTarget
  if (!target || target.workspaceId !== input.workspaceId || target.workspaceRuntimeId !== input.workspaceRuntimeId) {
    return null
  }
  const executionRootId = canonicalWorkspaceLocator(target.kind === 'workspace-root' ? target.workspaceId : target.root)
  return workspaceId && executionRootId ? formatTerminalFilesystemTargetKey(workspaceId, executionRootId) : null
}

function readTerminalRuntimeTabProviderProjection(
  input: WorkspacePaneRuntimeTabTargetInput,
): WorkspacePaneRuntimeTabProviderProjection {
  const targetKey = terminalRuntimeTabTargetKey(input)
  const snapshot = targetKey
    ? (readTerminalSessionCommandBridge()?.terminalFilesystemTargetSnapshot(targetKey) ?? null)
    : null
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

function readTerminalSelectedSessionId(terminalFilesystemTargetKey: string): string | null {
  return (
    workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey] ?? null
  )
}

function useTerminalRuntimeTabProviderProjection(
  input: MaybeRefOrGetter<WorkspacePaneRuntimeTabTargetInput>,
): ComputedRef<WorkspacePaneRuntimeTabProviderProjection> {
  const currentInput = computed(() => toValue(input))
  const targetKey = computed(() => terminalRuntimeTabTargetKey(currentInput.value))
  const terminalSessionSummaries = useTerminalSessionSummaries(targetKey)
  const terminalCreatePending = useTerminalFilesystemTargetCreatePending(targetKey)
  const terminalProjectionHydration = useTerminalWorkspaceProjectionHydrationEntry(() => currentInput.value.workspaceId)
  const selectedTerminalSessionIdByTarget = useStoreSelector(
    workspacesStore,
    (state) => state.selectedTerminalSessionIdByTerminalFilesystemTarget,
  )

  return computed(() => {
    const { workspaceRuntimeId } = currentInput.value
    const currentTargetKey = targetKey.value
    const selectedSessionId = currentTargetKey
      ? (selectedTerminalSessionIdByTarget.value[currentTargetKey] ?? null)
      : null
    const currentHydration =
      terminalProjectionHydration.value.workspaceRuntimeId === workspaceRuntimeId
        ? terminalProjectionHydration.value
        : null
    return {
      type: 'terminal' as const,
      targetKey: currentTargetKey,
      views: currentTargetKey ? terminalSessionSummaries.value : [],
      selectedSessionId,
      state: {
        createPending: terminalCreatePending.value,
        projectionPhase: currentHydration?.phase ?? 'pending',
        projectionErrorMessage: currentHydration?.errorMessage,
        selectedSessionId,
      },
    }
  })
}

function useSyncTerminalRuntimeTabSelection(
  input: MaybeRefOrGetter<{
    activeSessionIdByRuntimeType: WorkspacePaneRuntimeTabTargetSelectionByType
    runtimeTabTargetKeyByType: WorkspacePaneRuntimeTabTargetKeyByType
  }>,
  selectedSessionIdByRuntimeType: MaybeRefOrGetter<WorkspacePaneRuntimeTabTargetSelectionByType>,
): void {
  const setSelectedTerminal = workspacesStore.getState().setSelectedTerminal
  // The active tab and terminal store are separate authorities; synchronize
  // only the accepted active runtime selection at this boundary.
  watch(
    [() => toValue(input), () => toValue(selectedSessionIdByRuntimeType)],
    ([current, selected]) => {
      const activeTerminalSessionId = current.activeSessionIdByRuntimeType.terminal ?? null
      const selectedTerminalSessionId = selected.terminal ?? undefined
      const terminalFilesystemTargetKey = current.runtimeTabTargetKeyByType.terminal ?? null
      if (!terminalFilesystemTargetKey || !activeTerminalSessionId) return
      if (activeTerminalSessionId === selectedTerminalSessionId) return
      setSelectedTerminal(terminalFilesystemTargetKey, activeTerminalSessionId)
    },
    { immediate: true },
  )
}

function readTerminalRuntimeProjectionState(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): WorkspacePaneRuntimeProjectionState {
  const terminalProjectionHydration = terminalProjectionHydrationStore.getState().hydrationByWorkspace.get(workspaceId)
  const currentTerminalProjectionHydration =
    terminalProjectionHydration?.workspaceRuntimeId === workspaceRuntimeId ? terminalProjectionHydration : null
  return {
    phase: currentTerminalProjectionHydration?.phase ?? 'pending',
    errorMessage: currentTerminalProjectionHydration?.errorMessage,
  }
}
