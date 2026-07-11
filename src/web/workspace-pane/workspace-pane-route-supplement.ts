import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import type { RepoBranchWorkspacePaneRouteTarget } from '#/web/App.tsx'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

export interface WorkspacePaneRouteSupplementTarget {
  repoId: string
  repoRuntimeId: string
  branchName: string
  worktreePath: string | null
}

export function commitWorkspacePaneRouteSupplement(
  target: WorkspacePaneRouteSupplementTarget,
  route: RepoBranchWorkspacePaneRouteTarget,
): boolean {
  const state = useReposStore.getState()
  const repo = state.repos[target.repoId]
  if (!repo || repo.repoRuntimeId !== target.repoRuntimeId) return false
  const branchModel = readRepoBranchQueryProjection(repo)
  const branch = branchModel?.branches.find((candidate) => candidate.name === target.branchName)
  if (!branch || (branch.worktree?.path ?? null) !== target.worktreePath) return false
  state.setWorkspacePaneTab(
    target.repoId,
    target.branchName,
    route === null ? null : route.kind === 'static' ? route.tab : 'terminal',
  )
  if (route?.kind === 'terminal' && target.worktreePath) {
    state.setSelectedTerminal(
      formatTerminalWorktreeKey(target.repoId, target.worktreePath),
      route.terminalSessionId,
    )
  }
  return true
}
