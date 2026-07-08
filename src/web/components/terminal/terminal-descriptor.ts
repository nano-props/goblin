import type { TerminalDescriptor } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

export function terminalDescriptor(
  base: TerminalSessionBase,
  terminalSessionId: string,
  index: number,
): TerminalDescriptor {
  const terminalWorktreeKey = formatTerminalWorktreeKey(base.repoRoot, base.worktreePath)
  return {
    repoRoot: base.repoRoot,
    repoInstanceId: requireRepoInstanceId(base),
    branch: base.branch,
    worktreePath: base.worktreePath,
    terminalWorktreeKey,
    terminalSessionId,
    index,
  }
}

function requireRepoInstanceId(base: TerminalSessionBase): string {
  if (typeof base.repoInstanceId === 'string' && base.repoInstanceId.length > 0) return base.repoInstanceId
  throw new Error('error.repo-instance-stale')
}
