// Server-side session-scope normalization for the terminal subsystem.
// Lives in `server/terminal/` (not `shared/`) because it depends on
// `node:path`; importing it from a module that the client bundles
// triggers a Vite "node:path externalized" warning and would throw at
// runtime if the client ever invoked it.

import path from 'node:path'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'

/**
 * Normalize a repoRoot into the scope string the manager stores on
 * each session. For local repos this is the path-resolved form (so
 * `/repo` and `./repo` collapse to the same scope on every platform,
 * including Windows where `path.resolve('/repo')` becomes `C:\repo`).
 * For remote (SSH) repos the input is opaque and stays as-is.
 *
 * This is the **single source of truth** for session scope. Any
 * caller that needs to ask the manager about a repoRoot (create,
 * list, reorder, prune) must normalize through here first, otherwise
 * string-equality lookups will silently miss.
 */
export function terminalSessionScope(repoRoot: string): string {
  return isRemoteRepoId(repoRoot) ? repoRoot : path.resolve(repoRoot)
}

export function terminalSessionRuntimeScope(repoRoot: string, repoRuntimeId: string): string {
  return `${terminalSessionScope(repoRoot)}\0${repoRuntimeId}`
}

export function terminalSessionWorktreePath(repoRoot: string, worktreePath: string): string {
  return isRemoteRepoId(repoRoot) ? worktreePath : path.resolve(worktreePath)
}
