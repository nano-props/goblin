import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import type { TerminalRuntimeMembership, TerminalRuntimeMembershipIndex } from '#/web/components/terminal/types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export interface TerminalRuntimeMembershipEntry {
  id: WorkspaceId
  workspaceRuntimeId: string
}

export function useTerminalRuntimeMembershipIndex(): ComputedRef<TerminalRuntimeMembershipIndex> {
  const entries = useStoreSelector(
    workspacesStore,
    (state) => terminalRuntimeMembershipEntriesFromRepos(state.workspaces),
    entriesEqual,
  )
  return computed(() => runtimeMembershipIndexFromEntries(entries.value))
}

export function runtimeMembershipIndexFromEntries(
  entries: readonly TerminalRuntimeMembershipEntry[],
): TerminalRuntimeMembershipIndex {
  const index = new Map<WorkspaceId, TerminalRuntimeMembership>()
  for (const entry of entries) {
    index.set(entry.id, { workspaceRuntimeId: entry.workspaceRuntimeId })
  }
  return index
}

export function runtimeMembershipIndexEqual(
  left: TerminalRuntimeMembershipIndex,
  right: TerminalRuntimeMembershipIndex,
): boolean {
  if (left === right) return true
  if (left.size !== right.size) return false
  for (const [workspaceId, current] of left) {
    const next = right.get(workspaceId)
    if (!next || current.workspaceRuntimeId !== next.workspaceRuntimeId) return false
  }
  return true
}

function terminalRuntimeMembershipEntriesFromRepos(
  workspaces: WorkspacesStore['workspaces'],
): TerminalRuntimeMembershipEntry[] {
  return Object.values(workspaces).map((workspace) => ({
    id: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
  }))
}

function entriesEqual(
  left: readonly TerminalRuntimeMembershipEntry[],
  right: readonly TerminalRuntimeMembershipEntry[],
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((current, index) => {
    const next = right[index]
    return !!next && current.id === next.id && current.workspaceRuntimeId === next.workspaceRuntimeId
  })
}
