// Canonical slot/worktree key encoding for the terminal subsystem.
// The format is `${scope}\0${worktreePath}\0${slotId}` for slot
// keys and `${repoRoot}\0${worktreePath}` for worktree keys. Both
// segments are non-empty strings in normal use. The format is
// deliberately NUL-delimited because neither segment can contain
// `\0` (validated upstream) and a NUL split makes the key
// human-readable in logs.
//
// Scope normalization (`terminalSlotScope`) lives in
// `server/terminal/terminal-slot-scope.ts` because it depends on
// `node:path`. This file stays pure so the client can import the
// format/parse helpers via `web/components/terminal/terminal-slot-keys.ts`
// without dragging Node built-ins into the bundle.

const SLOT_KEY_SEGMENT = 3
const WORKTREE_SEGMENT = 2

export function formatTerminalSlotKey(repoRoot: string, worktreePath: string, slotId: string): string {
  return `${repoRoot}\0${worktreePath}\0${slotId}`
}

export function formatWorktreeKey(repoRoot: string, worktreePath: string): string {
  return `${repoRoot}\0${worktreePath}`
}

export interface ParsedTerminalSlotKey {
  repoRoot: string
  worktreePath: string
  slotId: string
}

export function parseTerminalSlotKey(key: string): ParsedTerminalSlotKey | null {
  const parts = key.split('\0')
  if (parts.length !== SLOT_KEY_SEGMENT) return null
  const [repoRoot, worktreePath, slotId] = parts
  if (!repoRoot || !worktreePath || !slotId) return null
  return { repoRoot, worktreePath, slotId }
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
 *  trailing slotId segment). Used by catalog prune logic. */
export function terminalPruneKeyFromSlotKey(slotKey: string): string | null {
  const parsed = parseTerminalSlotKey(slotKey)
  if (!parsed) return null
  return `${parsed.repoRoot}\0${parsed.worktreePath}`
}
