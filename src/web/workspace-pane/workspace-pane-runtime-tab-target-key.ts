import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

export interface WorkspacePaneRuntimeTabTargetKeyInput {
  repoRoot: string
  worktreePath: string | null
}

export function workspacePaneRuntimeTabTargetKey(input: WorkspacePaneRuntimeTabTargetKeyInput): string | null {
  return input.worktreePath ? formatTerminalWorktreeKey(input.repoRoot, input.worktreePath) : null
}
