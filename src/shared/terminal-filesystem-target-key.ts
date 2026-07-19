// Canonical terminal execution-target group key.
// Terminal sessions use `terminalSessionId` as their persistent identity. This key
// only names the terminal group for one Workspace/execution-root pair so selection
// and activity state can be indexed independently of Git capability.

import {
  canonicalWorkspaceLocator,
  type WorkspaceId,
  workspaceLocatorForPath,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'

const TARGET_KEY_SEGMENTS = 2

export type TerminalFilesystemTargetKey = string

export function formatTerminalFilesystemTargetKey(
  workspaceId: WorkspaceId,
  executionRootId: WorkspaceId,
): TerminalFilesystemTargetKey {
  if (
    canonicalWorkspaceLocator(workspaceId) !== workspaceId ||
    canonicalWorkspaceLocator(executionRootId) !== executionRootId ||
    !workspaceLocatorsShareTransport(workspaceId, executionRootId)
  ) {
    throw new Error('terminal target key requires compatible canonical workspace roots')
  }
  return `${workspaceId}\0${executionRootId}`
}

export function formatTerminalFilesystemTargetKeyForPath(
  workspaceId: WorkspaceId,
  executionRootPath: string,
): TerminalFilesystemTargetKey {
  const executionRootId =
    canonicalWorkspaceLocator(executionRootPath) ?? workspaceLocatorForPath(workspaceId, executionRootPath)
  if (!executionRootId || !workspaceLocatorsShareTransport(workspaceId, executionRootId)) {
    throw new Error('terminal target key requires compatible canonical workspace roots')
  }
  return formatTerminalFilesystemTargetKey(workspaceId, executionRootId)
}

export interface ParsedTerminalFilesystemTargetKey {
  workspaceId: WorkspaceId
  executionRootId: WorkspaceId
}

export function parseTerminalFilesystemTargetKey(key: string): ParsedTerminalFilesystemTargetKey | null {
  const parts = key.split('\0')
  if (parts.length !== TARGET_KEY_SEGMENTS) return null
  const [workspaceIdInput, executionRootIdInput] = parts
  if (!workspaceIdInput || !executionRootIdInput) return null
  const workspaceId = canonicalWorkspaceLocator(workspaceIdInput)
  const executionRootId = canonicalWorkspaceLocator(executionRootIdInput)
  if (!workspaceId || !executionRootId || !workspaceLocatorsShareTransport(workspaceId, executionRootId)) return null
  return { workspaceId, executionRootId }
}
