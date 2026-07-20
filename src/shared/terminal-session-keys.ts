import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export interface TerminalSessionUserFilesystemTargetKeyInput {
  userId: string | number
  scope: string
  executionRootId: WorkspaceId
}

export function terminalSessionUserFilesystemTargetKey(input: TerminalSessionUserFilesystemTargetKeyInput): string {
  return `${String(input.userId)}\0${input.scope}\0${input.executionRootId}`
}
