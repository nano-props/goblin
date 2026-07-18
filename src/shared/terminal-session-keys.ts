import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface TerminalSessionUserWorktreeKeyInput {
  userId: string | number
  scope: string
  worktreeId: WorkspaceId
}

export function terminalSessionUserWorktreeKey(input: TerminalSessionUserWorktreeKeyInput): string {
  return `${String(input.userId)}\0${input.scope}\0${input.worktreeId}`
}
