// Canonical terminal worktree group key.
// Terminal sessions use `terminalSessionId` as their persistent identity. This key
// only names the terminal group for one repo/worktree pair so workspace and
// activity state can be indexed per worktree.

import {
  canonicalWorkspaceLocator,
  type WorkspaceId,
  workspaceLocatorForPath,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'

const WORKTREE_SEGMENT = 2

export type TerminalWorktreeKey = string

export function formatTerminalWorktreeKey(workspaceId: WorkspaceId, worktreeRoot: WorkspaceId): TerminalWorktreeKey {
  if (
    canonicalWorkspaceLocator(workspaceId) !== workspaceId ||
    canonicalWorkspaceLocator(worktreeRoot) !== worktreeRoot ||
    !workspaceLocatorsShareTransport(workspaceId, worktreeRoot)
  ) {
    throw new Error('terminal worktree key requires compatible canonical workspace roots')
  }
  return `${workspaceId}\0${worktreeRoot}`
}

export function formatTerminalWorktreeKeyForPath(workspaceId: WorkspaceId, worktreePath: string): TerminalWorktreeKey {
  const worktreeId =
    canonicalWorkspaceLocator(worktreePath) ?? workspaceLocatorForPath(workspaceId, worktreePath)
  if (!worktreeId || !workspaceLocatorsShareTransport(workspaceId, worktreeId)) {
    throw new Error('terminal worktree key requires compatible canonical workspace roots')
  }
  return formatTerminalWorktreeKey(workspaceId, worktreeId)
}

export interface ParsedTerminalWorktreeKey {
  workspaceId: WorkspaceId
  worktreeId: WorkspaceId
}

export function parseTerminalWorktreeKey(key: string): ParsedTerminalWorktreeKey | null {
  const parts = key.split('\0')
  if (parts.length !== WORKTREE_SEGMENT) return null
  const [workspaceIdInput, worktreeIdInput] = parts
  if (!workspaceIdInput || !worktreeIdInput) return null
  const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
  const worktreeId = canonicalWorkspaceLocator(worktreeIdInput)
  if (!workspaceId || !worktreeId || !workspaceLocatorsShareTransport(workspaceId, worktreeId)) return null
  return { workspaceId, worktreeId }
}
