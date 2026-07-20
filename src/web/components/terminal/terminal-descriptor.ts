import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import { terminalExecutionCoordinates, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import { formatTerminalFilesystemTargetKey } from '#/shared/terminal-filesystem-target-key.ts'

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

export function terminalDescriptorFilesystemTargetKey(descriptor: TerminalDescriptor): string {
  const coordinates = terminalExecutionCoordinates(descriptor.target)
  return formatTerminalFilesystemTargetKey(coordinates.workspaceId, coordinates.executionRootId)
}
