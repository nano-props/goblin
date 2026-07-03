import { useQueries } from '@tanstack/react-query'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalRepoIndex } from '#/web/components/terminal/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { repoSnapshotQueryOptions } from '#/web/repo-data-query.ts'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'

export interface TerminalRepoIndexEntry {
  id: string
  instanceId: string
  data: ReposStore['repos'][string]['data']
}

export function useTerminalRepoIndex(): TerminalRepoIndex {
  const entries = useStoreWithEqualityFn(useReposStore, (s) => terminalRepoIndexEntriesFromRepos(s.repos), entriesEqual)
  const snapshotQueries = useQueries({
    queries: entries.map((entry) => ({
      ...repoSnapshotQueryOptions(entry.id, entry.instanceId),
      enabled: false,
      subscribed: true,
    })),
  })
  return repoIndexFromEntries(
    entries,
    snapshotQueries.map((query) => query.data ?? null),
  )
}

export function repoIndexFromEntries(
  entries: readonly TerminalRepoIndexEntry[],
  snapshots: readonly (RepoSnapshot | null)[] = [],
): TerminalRepoIndex {
  const index: TerminalRepoIndex = {}
  entries.forEach((repo, indexInEntries) => {
    const snapshot = snapshots[indexInEntries] ?? null
    const branchReadModel = snapshot ? repoBranchReadModelFromSnapshot(snapshot, repo.data) : null
    const branches = branchReadModel?.branches ?? repo.data.branches
    const branchByWorktreePath: Record<string, string> = {}
    for (const branch of branches) {
      const worktreePath = branch.worktree?.path
      if (worktreePath) branchByWorktreePath[worktreePath] = branch.name
    }
    index[repo.id] = {
      instanceId: repo.instanceId,
      branchByWorktreePath,
    }
  })
  return index
}

export function repoIndexEqual(a: TerminalRepoIndex, b: TerminalRepoIndex): boolean {
  if (a === b) return true
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const repoRoot of aKeys) {
    const current = a[repoRoot]
    const next = b[repoRoot]
    if (!current || !next) return false
    if (current.instanceId !== next.instanceId) return false
    const currentPaths = Object.keys(current.branchByWorktreePath)
    const nextPaths = Object.keys(next.branchByWorktreePath)
    if (currentPaths.length !== nextPaths.length) return false
    for (const worktreePath of currentPaths) {
      if (current.branchByWorktreePath[worktreePath] !== next.branchByWorktreePath[worktreePath]) return false
    }
  }
  return true
}

export function branchForTerminalWorktree(
  repoIndex: TerminalRepoIndex,
  repoRoot: string,
  worktreePath: string,
): string | null {
  return repoIndex[repoRoot]?.branchByWorktreePath[worktreePath] ?? null
}

function terminalRepoIndexEntriesFromRepos(repos: ReposStore['repos']): TerminalRepoIndexEntry[] {
  return Object.values(repos).map((repo) => ({
    id: repo.id,
    instanceId: repo.instanceId,
    data: repo.data,
  }))
}

function entriesEqual(a: readonly TerminalRepoIndexEntry[], b: readonly TerminalRepoIndexEntry[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const current = a[index]
    const next = b[index]
    if (!current || !next) return false
    if (current.id !== next.id) return false
    if (current.instanceId !== next.instanceId) return false
    if (current.data !== next.data) return false
  }
  return true
}
