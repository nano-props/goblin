import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { formatTerminalWorktreeKey, formatTerminalWorkspaceSlotKey } from '#/shared/terminal-workspace-slot-key.ts'

export function terminalDescriptor(base: TerminalSessionBase, sessionId: string, index: number): TerminalDescriptor {
  const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
  return {
    ...base,
    terminalWorktreeKey: terminalWorktreeKey,
    sessionId,
    index,
    terminalKey: formatTerminalWorkspaceSlotKey(base.repoRoot, base.worktreePath, sessionId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repo = repos[descriptor.repoRoot]
  return !!repo?.data.branches.some((branch) => branch.worktree?.path === descriptor.worktreePath)
}
