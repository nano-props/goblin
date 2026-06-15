// Canonical session/worktree key encoding for the terminal subsystem.
// The format is `${scope}\0${worktreePath}\0${terminalId}` for session
// keys and `${repoRoot}\0${worktreePath}` for worktree scopes. Both
// segments are non-empty strings in normal use. The format is
// deliberately NUL-delimited because neither segment can contain
// `\0` (validated upstream) and a NUL split makes the key
// human-readable in logs.

import path from 'node:path'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'

const KEY_SEGMENT = 3
const WORKTREE_SEGMENT = 2

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

export function formatTerminalSessionKey(repoRoot: string, worktreePath: string, terminalId: string): string {
  return `${repoRoot}\0${worktreePath}\0${terminalId}`
}

export function formatWorktreeTerminalKey(repoRoot: string, worktreePath: string): string {
  return `${repoRoot}\0${worktreePath}`
}

export interface ParsedTerminalSessionKey {
  repoRoot: string
  worktreePath: string
  terminalId: string
}

export function parseTerminalSessionKey(key: string): ParsedTerminalSessionKey | null {
  const parts = key.split('\0')
  if (parts.length !== KEY_SEGMENT) return null
  const [repoRoot, worktreePath, terminalId] = parts
  if (!repoRoot || !worktreePath || !terminalId) return null
  return { repoRoot, worktreePath, terminalId }
}

export interface ParsedWorktreeTerminalKey {
  repoRoot: string
  worktreePath: string
}

export function parseWorktreeTerminalKey(key: string): ParsedWorktreeTerminalKey | null {
  const parts = key.split('\0')
  if (parts.length !== WORKTREE_SEGMENT) return null
  const [repoRoot, worktreePath] = parts
  if (!repoRoot || !worktreePath) return null
  return { repoRoot, worktreePath }
}

/** Build a `${scope}\0${worktreePath}` key from a session key (drops the
 *  trailing terminalId segment). Used by catalog prune logic. */
export function terminalPruneKeyFromSessionKey(sessionKey: string): string | null {
  const parsed = parseTerminalSessionKey(sessionKey)
  if (!parsed) return null
  return `${parsed.repoRoot}\0${parsed.worktreePath}`
}
