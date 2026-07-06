const WORKTREE_SEGMENT = 2

export type AgentWorktreeKey = string

export function formatAgentWorktreeKey(repoRoot: string, worktreePath: string): AgentWorktreeKey {
  return `${repoRoot}\0${worktreePath}`
}

export interface ParsedAgentWorktreeKey {
  repoRoot: string
  worktreePath: string
}

export function parseAgentWorktreeKey(key: string): ParsedAgentWorktreeKey | null {
  const parts = key.split('\0')
  if (parts.length !== WORKTREE_SEGMENT) return null
  const [repoRoot, worktreePath] = parts
  if (!repoRoot || !worktreePath) return null
  return { repoRoot, worktreePath }
}
