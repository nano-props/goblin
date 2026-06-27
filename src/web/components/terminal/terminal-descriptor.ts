import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalDescriptor, TerminalSessionBase } from '#/web/components/terminal/types.ts'
import {
  formatTerminalWorkspaceSlotKey,
  worktreeTerminalKey,
} from '#/web/components/terminal/terminal-workspace-slot-keys.ts'

export function terminalDescriptor(base: TerminalSessionBase, slotId: string, index: number): TerminalDescriptor {
  const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
  return {
    ...base,
    worktreeTerminalKey: terminalWorktreeKey,
    slotId,
    index,
    key: formatTerminalWorkspaceSlotKey(base.repoRoot, base.worktreePath, slotId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repo = repos[descriptor.repoRoot]
  return !!repo?.data.branches.some((branch) => branch.worktree?.path === descriptor.worktreePath)
}
