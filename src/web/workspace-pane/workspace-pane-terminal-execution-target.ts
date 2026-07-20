import type { TerminalPresentation, TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'

/**
 * Binds an already-canonical filesystem execution target to its independent
 * pane presentation. Git branch targets deliberately have no execution root.
 */
export function resolveWorkspacePaneTerminalExecutionTarget(
  target: RuntimeWorkspacePaneTarget,
  presentation: TerminalPresentation,
): TerminalSessionBase | null {
  if (target.kind === 'workspace-root' && presentation.kind === 'workspace-root') return { target, presentation }
  if (target.kind === 'git-worktree' && presentation.kind === 'git-worktree') return { target, presentation }
  return null
}
