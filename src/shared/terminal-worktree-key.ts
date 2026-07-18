// Canonical terminal worktree group key.
// Terminal sessions use `terminalSessionId` as their persistent identity. This key
// only names the terminal group for one repo/worktree pair so workspace and
// activity state can be indexed per worktree.

import {
  canonicalWorkspaceLocator,
  workspaceLocatorForPath,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'

const WORKTREE_SEGMENT = 2

export type TerminalWorktreeKey = string

export function formatTerminalWorktreeKey(repoRoot: string, worktreeRoot: string): TerminalWorktreeKey {
  if (
    canonicalWorkspaceLocator(repoRoot) !== repoRoot ||
    canonicalWorkspaceLocator(worktreeRoot) !== worktreeRoot ||
    !workspaceLocatorsShareTransport(repoRoot, worktreeRoot)
  ) {
    throw new Error('terminal worktree key requires compatible canonical workspace roots')
  }
  return `${repoRoot}\0${worktreeRoot}`
}

export function formatTerminalWorktreeKeyForPath(repoRoot: string, worktreePath: string): TerminalWorktreeKey {
  const workspaceId = canonicalWorkspaceLocator(repoRoot)
  const worktreeId =
    canonicalWorkspaceLocator(worktreePath) ?? (workspaceId ? workspaceLocatorForPath(workspaceId, worktreePath) : null)
  if (!workspaceId || !worktreeId || !workspaceLocatorsShareTransport(workspaceId, worktreeId)) {
    throw new Error('terminal worktree key requires compatible canonical workspace roots')
  }
  return formatTerminalWorktreeKey(workspaceId, worktreeId)
}

export interface ParsedTerminalWorktreeKey {
  repoRoot: string
  worktreeId: string
}

export function parseTerminalWorktreeKey(key: string): ParsedTerminalWorktreeKey | null {
  const parts = key.split('\0')
  if (parts.length !== WORKTREE_SEGMENT) return null
  const [repoRoot, worktreeId] = parts
  if (!repoRoot || !worktreeId) return null
  if (
    canonicalWorkspaceLocator(repoRoot) !== repoRoot ||
    canonicalWorkspaceLocator(worktreeId) !== worktreeId ||
    !workspaceLocatorsShareTransport(repoRoot, worktreeId)
  ) {
    return null
  }
  return { repoRoot, worktreeId }
}
