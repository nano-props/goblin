import type { ReposStore } from '#/renderer/stores/repos/types.ts'
import type { TerminalDescriptor, TerminalSessionBase } from '#/renderer/components/terminal/types.ts'

export function terminalSessionGroupKey(repoRoot: string, worktreePath: string): string {
  return `${repoRoot}\0${worktreePath}`
}

export function terminalSessionKey(repoRoot: string, worktreePath: string, terminalId: string): string {
  return `${terminalSessionGroupKey(repoRoot, worktreePath)}\0${terminalId}`
}

export function terminalDescriptor(base: TerminalSessionBase, terminalId: string, index: number): TerminalDescriptor {
  const groupKey = terminalSessionGroupKey(base.repoRoot, base.worktreePath)
  return {
    ...base,
    groupKey,
    terminalId,
    index,
    key: terminalSessionKey(base.repoRoot, base.worktreePath, terminalId),
  }
}

export function isTerminalDescriptorLive(repos: ReposStore['repos'], descriptor: TerminalDescriptor): boolean {
  const repo = repos[descriptor.repoRoot]
  return !!repo?.data.branches.some((branch) => branch.worktreePath === descriptor.worktreePath)
}
