
export interface TerminalSessionUserWorktreeKeyInput {
  userId: string | number
  scope: string
  worktreePath: string
}

export function terminalSessionUserWorktreeKey(input: TerminalSessionUserWorktreeKeyInput): string {
  return `${String(input.userId)}\0${input.scope}\0${input.worktreePath}`
}
