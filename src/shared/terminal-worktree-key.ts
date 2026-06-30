// Canonical terminal worktree group key.
// Terminal sessions use `terminalSessionId` as their persistent identity. This key
// only names the terminal group for one repo/worktree pair so workspace and
// activity state can be indexed per worktree.

const WORKTREE_SEGMENT = 2

export type TerminalWorktreeKey = string

export function formatTerminalWorktreeKey(repoRoot: string, worktreePath: string): TerminalWorktreeKey {
  return `${repoRoot}\0${worktreePath}`
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
