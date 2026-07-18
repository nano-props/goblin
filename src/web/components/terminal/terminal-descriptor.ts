import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { terminalExecutionCoordinates, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

export function terminalDescriptor(
  base: TerminalSessionBase,
  terminalSessionId: string,
  index: number,
): TerminalDescriptor {
  const identity = {
    terminalSessionId,
    index,
  }
  if (base.target.kind === 'workspace-root' && base.presentation.kind === 'workspace-root') {
    return { ...identity, target: base.target, presentation: base.presentation }
  }
  if (base.target.kind === 'git-worktree' && base.presentation.kind === 'git-worktree') {
    return { ...identity, target: base.target, presentation: base.presentation }
  }
  throw new Error('terminal target and presentation disagree')
}

export function terminalDescriptorWorktreeKey(descriptor: TerminalDescriptor): string {
  const coordinates = terminalExecutionCoordinates(descriptor.target)
  return formatTerminalWorktreeKey(coordinates.repoRoot, coordinates.worktreeId)
}
