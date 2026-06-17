// Canonical session/worktree key encoding for the terminal subsystem.
// The format is `${scope}\0${worktreePath}\0${terminalId}` for session
// keys and `${repoRoot}\0${worktreePath}` for worktree scopes. Both
// segments are non-empty strings in normal use. The format is
// deliberately NUL-delimited because neither segment can contain
// `\0` (validated upstream) and a NUL split makes the key
// human-readable in logs.
//
// Scope normalization (`terminalSessionScope`) lives in
// `server/terminal/terminal-session-scope.ts` because it depends on
// `node:path`. This file stays pure so the renderer can import the
// format/parse helpers via `web/components/terminal/terminal-session-keys.ts`
// without dragging Node built-ins into the bundle.

const KEY_SEGMENT = 3
const WORKTREE_SEGMENT = 2

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
