// Canonical terminal key encoding.
// `TerminalKey` names one terminal session and is also the persisted identity
// for that terminal's workspace-pane tab. `TerminalWorktreeKey` names the
// terminal group for one worktree. The formats are
// `${scope}\0${worktreePath}\0${sessionId}` and `${repoRoot}\0${worktreePath}`.
// Segments are non-empty strings in normal use. The format is
// deliberately NUL-delimited because neither segment can contain
// `\0` (validated upstream) and a NUL split makes the key
// human-readable in logs.
//
// Scope normalization (`terminalSessionScope`) lives in
// `server/terminal/terminal-session-scope.ts` because it depends on
// `node:path`. This file stays pure so the client can import it directly
// without dragging Node built-ins into the bundle.

const SLOT_KEY_SEGMENT = 3
const WORKTREE_SEGMENT = 2

export type TerminalKey = string
export type TerminalWorktreeKey = string

export function formatTerminalWorkspaceSlotKey(repoRoot: string, worktreePath: string, sessionId: string): TerminalKey {
  return `${repoRoot}\0${worktreePath}\0${sessionId}`
}

export function formatTerminalWorktreeKey(repoRoot: string, worktreePath: string): TerminalWorktreeKey {
  return `${repoRoot}\0${worktreePath}`
}

export interface ParsedTerminalWorkspaceSlotKey {
  repoRoot: string
  worktreePath: string
  sessionId: string
}

export function parseTerminalWorkspaceSlotKey(key: string): ParsedTerminalWorkspaceSlotKey | null {
  const parts = key.split('\0')
  if (parts.length !== SLOT_KEY_SEGMENT) return null
  const [repoRoot, worktreePath, sessionId] = parts
  if (!repoRoot || !worktreePath || !sessionId) return null
  return { repoRoot, worktreePath, sessionId }
}

export interface ParsedTerminalWorktreeKey {
  repoRoot: string
  worktreePath: string
}

export function parseTerminalWorktreeKey(key: string): ParsedTerminalWorktreeKey | null {
  const parts = key.split('\0')
  if (parts.length !== WORKTREE_SEGMENT) return null
  const [repoRoot, worktreePath] = parts
  if (!repoRoot || !worktreePath) return null
  return { repoRoot, worktreePath }
}

/** Build a terminal worktree key from a terminal key by dropping the trailing sessionId segment. */
export function terminalPruneKeyFromSlotKey(slotKey: string): TerminalWorktreeKey | null {
  const parsed = parseTerminalWorkspaceSlotKey(slotKey)
  if (!parsed) return null
  return `${parsed.repoRoot}\0${parsed.worktreePath}`
}
