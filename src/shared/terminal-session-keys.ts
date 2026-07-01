import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

export interface TerminalSessionUserWorktreeKeyInput {
  userId: string | number
  scope: string
  worktreePath: string
}

export function terminalSessionUserWorktreeKey(input: TerminalSessionUserWorktreeKeyInput): string {
  return `${String(input.userId)}\0${formatTerminalWorktreeKey(input.scope, input.worktreePath)}`
}
