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
    repoRuntimeId: requireRepoRuntimeId(base),
    branch: base.branch,
    worktreePath: base.worktreePath,
    terminalWorktreeKey,
    terminalSessionId,
    index,
  }
}

function requireRepoRuntimeId(base: TerminalSessionBase): string {
  if (typeof base.repoRuntimeId === 'string' && base.repoRuntimeId.length > 0) return base.repoRuntimeId
  throw new Error('error.repo-runtime-stale')
}
