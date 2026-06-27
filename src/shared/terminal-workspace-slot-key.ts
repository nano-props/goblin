// Canonical slot/worktree key encoding for the terminal subsystem.
// The format is `${scope}\0${worktreePath}\0${sessionId}` for slot
// keys and `${repoRoot}\0${worktreePath}` for worktree keys. Both
// segments are non-empty strings in normal use. The format is
// deliberately NUL-delimited because neither segment can contain
// `\0` (validated upstream) and a NUL split makes the key
// human-readable in logs.
//
// Scope normalization (`terminalSessionScope`) lives in
// `server/terminal/terminal-session-scope.ts` because it depends on
// `node:path`. This file stays pure so the client can import the
// format/parse helpers via `web/components/terminal/terminal-workspace-slot-keys.ts`
// without dragging Node built-ins into the bundle.

const SLOT_KEY_SEGMENT = 3
const WORKTREE_SEGMENT = 2

export function formatTerminalWorkspaceSlotKey(repoRoot: string, worktreePath: string, sessionId: string): string {
  return `${repoRoot}\0${worktreePath}\0${sessionId}`
}

export function formatWorktreeKey(repoRoot: string, worktreePath: string): string {
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

export interface ParsedWorktreeKey {
  repoRoot: string
  worktreePath: string
}

export function parseWorktreeKey(key: string): ParsedWorktreeKey | null {
  const parts = key.split('\0')
  if (parts.length !== WORKTREE_SEGMENT) return null
  const [repoRoot, worktreePath] = parts
  if (!repoRoot || !worktreePath) return null
  return { repoRoot, worktreePath }
}

/** Build a `${scope}\0${worktreePath}` key from a slot key (drops the
 *  trailing sessionId segment). Used by catalog prune logic. */
export function terminalPruneKeyFromSlotKey(slotKey: string): string | null {
  const parsed = parseTerminalWorkspaceSlotKey(slotKey)
  if (!parsed) return null
  return `${parsed.repoRoot}\0${parsed.worktreePath}`
}
