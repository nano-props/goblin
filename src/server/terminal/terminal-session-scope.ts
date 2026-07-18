// Server-side session-scope normalization for the terminal subsystem.
// Lives in `server/terminal/` (not `shared/`) because it depends on
// `node:path`; importing it from a module that the client bundles
// triggers a Vite "node:path externalized" warning and would throw at
// runtime if the client ever invoked it.

import path from 'node:path'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'

/**
 * Runtime scopes are keyed by canonical workspace identity. Native paths are
 * execution metadata and must never be allowed to rewrite this identity.
 *
 * This is the **single source of truth** for session scope. Any
 * caller that needs to ask the manager about a repoRoot (create,
 * list, reorder, prune) must normalize through here first, otherwise
 * string-equality lookups will silently miss.
 */
export function terminalSessionScope(repoRoot: string): string {
  if (!parseCanonicalWorkspaceLocator(repoRoot)) throw new Error('error.workspace-locator-malformed')
  return repoRoot
}

export function terminalSessionRuntimeScope(repoRoot: string, repoRuntimeId: string): string {
  return `${terminalSessionScope(repoRoot)}\0${repoRuntimeId}`
}

export function terminalSessionScopeBelongsToRepo(scope: string, repoRoot: string): boolean {
  return scope.startsWith(`${terminalSessionScope(repoRoot)}\0`)
}

export function terminalSessionWorktreePath(repoRoot: string, worktreePath: string): string {
  const workspace = parseCanonicalWorkspaceLocator(repoRoot)
  if (!workspace) throw new Error('error.workspace-locator-malformed')
  if (worktreePath === repoRoot) return workspace.path
  return workspace.transport === 'ssh' ? worktreePath : path.resolve(worktreePath)
}

export function terminalSessionTargetWorktreePath(
  target: RuntimeWorkspacePaneTarget,
): string | null {
  if (target.kind === 'git-branch') return null
  const expected = parseCanonicalWorkspaceLocator(target.kind === 'workspace-root' ? target.workspaceId : target.root)
  if (!expected) return null
  return expected.path
}
