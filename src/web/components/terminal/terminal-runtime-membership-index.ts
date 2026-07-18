import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalRuntimeMembershipIndex } from '#/web/components/terminal/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

export interface TerminalRuntimeMembershipEntry {
  id: string
  workspaceRuntimeId: string
}

export function useTerminalRuntimeMembershipIndex(): TerminalRuntimeMembershipIndex {
  const entries = useStoreWithEqualityFn(
    useReposStore,
    (s) => terminalRuntimeMembershipEntriesFromRepos(s.repos),
    entriesEqual,
  )
  return runtimeMembershipIndexFromEntries(entries)
}

export function runtimeMembershipIndexFromEntries(
  entries: readonly TerminalRuntimeMembershipEntry[],
): TerminalRuntimeMembershipIndex {
  const index: TerminalRuntimeMembershipIndex = {}
  entries.forEach((repo) => {
    index[repo.id] = {
      workspaceRuntimeId: repo.workspaceRuntimeId,
    }
  })
  return index
}

export function runtimeMembershipIndexEqual(
  a: TerminalRuntimeMembershipIndex,
  b: TerminalRuntimeMembershipIndex,
): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const repoRoot of aKeys) {
    const current = a[repoRoot]
    const next = b[repoRoot]
    if (!current || !next) return false
    if (current.workspaceRuntimeId !== next.workspaceRuntimeId) return false
  }
  return true
}

function terminalRuntimeMembershipEntriesFromRepos(repos: ReposStore['repos']): TerminalRuntimeMembershipEntry[] {
  return Object.values(repos).map((repo) => ({
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
