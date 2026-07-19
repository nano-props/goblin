import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { WorkspacesStore } from '#/web/stores/workspaces/types.ts'
import type {
  TerminalRuntimeMembership,
  TerminalRuntimeMembershipIndex,
} from '#/web/components/terminal/types.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface TerminalRuntimeMembershipEntry {
  id: WorkspaceId
  workspaceRuntimeId: string
}

export function useTerminalRuntimeMembershipIndex(): TerminalRuntimeMembershipIndex {
  const entries = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s) => terminalRuntimeMembershipEntriesFromRepos(s.workspaces),
    entriesEqual,
  )
  return runtimeMembershipIndexFromEntries(entries)
}

export function runtimeMembershipIndexFromEntries(
  entries: readonly TerminalRuntimeMembershipEntry[],
): TerminalRuntimeMembershipIndex {
  const index = new Map<WorkspaceId, TerminalRuntimeMembership>()
  entries.forEach((repo) => {
    index.set(repo.id, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
  })
  return index
}

export function runtimeMembershipIndexEqual(
  a: TerminalRuntimeMembershipIndex,
  b: TerminalRuntimeMembershipIndex,
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [workspaceId, current] of a) {
    const next = b.get(workspaceId)
    if (!current || !next) return false
    if (current.workspaceRuntimeId !== next.workspaceRuntimeId) return false
  }
  return true
}

function terminalRuntimeMembershipEntriesFromRepos(
  workspaces: WorkspacesStore['workspaces'],
): TerminalRuntimeMembershipEntry[] {
  return Object.values(workspaces).map((repo) => ({
    id: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
  }))
}

function entriesEqual(
  a: readonly TerminalRuntimeMembershipEntry[],
  b: readonly TerminalRuntimeMembershipEntry[],
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const current = a[index]
    const next = b[index]
    if (!current || !next) return false
    if (current.id !== next.id) return false
    if (current.workspaceRuntimeId !== next.workspaceRuntimeId) return false
  }
  return true
}
