import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalRepoIndex } from '#/web/components/terminal/types.ts'

export function repoIndexFromRepos(repos: ReposStore['repos']): TerminalRepoIndex {
  const index: TerminalRepoIndex = {}
  for (const [repoRoot, repo] of Object.entries(repos)) {
    const branchByWorktreePath: Record<string, string> = {}
    for (const branch of repo.data.branches) {
      const worktreePath = branch.worktree?.path
      if (worktreePath) branchByWorktreePath[worktreePath] = branch.name
    }
    index[repoRoot] = {
      instanceToken: repo.instanceToken,
      branchByWorktreePath,
    }
  }
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
    if (current.instanceToken !== next.instanceToken) return false
    const currentPaths = Object.keys(current.branchByWorktreePath)
    const nextPaths = Object.keys(next.branchByWorktreePath)
    if (currentPaths.length !== nextPaths.length) return false
    for (const worktreePath of currentPaths) {
      if (current.branchByWorktreePath[worktreePath] !== next.branchByWorktreePath[worktreePath]) return false
    }
  }
  return true
}

export function branchForTerminalWorktree(repoIndex: TerminalRepoIndex, repoRoot: string, worktreePath: string): string | null {
  return repoIndex[repoRoot]?.branchByWorktreePath[worktreePath] ?? null
}
