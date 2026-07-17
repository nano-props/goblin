import { useQueries } from '@tanstack/react-query'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalRepoIndex } from '#/web/components/terminal/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { repoProjectionQueryOptions } from '#/web/repo-data-query.ts'
import { repoBranchSnapshotDataFromSnapshot } from '#/web/repo-branch-read-model.ts'
import type { RepoSnapshot } from '#/shared/api-types.ts'
import { workspaceGitAvailable } from '#/shared/workspace-runtime.ts'

export interface TerminalRepoIndexEntry {
  id: string
  repoRuntimeId: string
  gitAvailable: boolean
}

export function useTerminalRepoIndex(): TerminalRepoIndex {
  const entries = useStoreWithEqualityFn(useReposStore, (s) => terminalRepoIndexEntriesFromRepos(s.repos), entriesEqual)
  const projectionQueries = useQueries({
    queries: entries.map((entry) => ({
      ...repoProjectionQueryOptions(entry.id, entry.repoRuntimeId, null, 'full'),
      enabled: entry.gitAvailable,
      subscribed: entry.gitAvailable,
    })),
  })
  return repoIndexFromEntries(
    entries,
    projectionQueries.map((query) => query.data?.snapshot ?? null),
  )
}

export function repoIndexFromEntries(
  entries: readonly TerminalRepoIndexEntry[],
  snapshots: readonly (RepoSnapshot | null)[] = [],
): TerminalRepoIndex {
  const index: TerminalRepoIndex = {}
  entries.forEach((repo, indexInEntries) => {
    const snapshot = snapshots[indexInEntries] ?? null
    const branchSnapshot = snapshot ? repoBranchSnapshotDataFromSnapshot(snapshot) : null
    const branches = branchSnapshot?.branches ?? []
    const branchByWorktreePath: Record<string, string> = {}
    for (const branch of branches) {
      const worktreePath = branch.worktree?.path
      if (worktreePath) branchByWorktreePath[worktreePath] = branch.name
    }
    index[repo.id] = {
      repoRuntimeId: repo.repoRuntimeId,
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
    if (current.repoRuntimeId !== next.repoRuntimeId) return false
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
    repoRuntimeId: repo.repoRuntimeId,
    gitAvailable: workspaceGitAvailable(repo.workspaceProbe),
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
    if (current.repoRuntimeId !== next.repoRuntimeId) return false
    if (current.gitAvailable !== next.gitAvailable) return false
  }
  return true
}
