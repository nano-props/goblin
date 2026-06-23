import type { ReposStore } from '#/web/stores/repos/types.ts'
import type { TerminalDescriptor, TerminalSlotBase } from '#/web/components/terminal/types.ts'
import { terminalSessionKey, worktreeTerminalKey } from '#/web/components/terminal/terminal-slot-keys.ts'

export function terminalDescriptor(base: TerminalSlotBase, slotId: string, index: number): TerminalDescriptor {
  const terminalWorktreeKey = worktreeTerminalKey(base.repoRoot, base.worktreePath)
  return {
    ...base,
    worktreeTerminalKey: terminalWorktreeKey,
    slotId,
    index,
    key: terminalSessionKey(base.repoRoot, base.worktreePath, slotId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repo = repos[descriptor.repoRoot]
  return !!repo?.data.branches.some((branch) => branch.worktree?.path === descriptor.worktreePath)
}
