import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

export interface WorkspacePaneTerminalTargetInput {
  repoId: string
  branchName: string | null
  worktreePath: string | null
}

export function terminalBaseForWorkspacePaneTarget(
  target: WorkspacePaneTerminalTargetInput,
): TerminalSessionBase | null {
  if (!target.branchName || !target.worktreePath) return null
  return {
    repoRoot: target.repoId,
    branch: target.branchName,
    worktreePath: target.worktreePath,
  }
}
