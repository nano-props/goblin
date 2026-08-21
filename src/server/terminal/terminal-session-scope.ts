// Server-only session-scope normalization; execution paths depend on node:path.

import path from 'node:path'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'

/**
 * Runtime scopes are keyed by canonical workspace identity. Native paths are
 * execution metadata and must never be allowed to rewrite this identity.
 *
 * All manager lookups normalize through this boundary so string equality uses
 * one canonical identity.
 */
export function terminalSessionScope(workspaceId: WorkspaceId): string {
  if (!parseCanonicalWorkspaceLocator(workspaceId)) throw new Error('error.workspace-locator-malformed')
  return workspaceId
}

export function terminalSessionRuntimeScope(workspaceId: WorkspaceId, workspaceRuntimeId: string): string {
  return `${terminalSessionScope(workspaceId)}\0${workspaceRuntimeId}`
}

export function terminalSessionExecutionPath(workspaceId: WorkspaceId, executionPath: string): string {
  const workspace = parseCanonicalWorkspaceLocator(workspaceId)
  if (!workspace) throw new Error('error.workspace-locator-malformed')
  if (executionPath === workspaceId) return workspace.path
  return workspace.transport === 'ssh' ? executionPath : path.resolve(executionPath)
}

export function terminalSessionTargetExecutionPath(target: RuntimeWorkspacePaneTarget): string | null {
  if (target.kind === 'git-branch') return null
  const expected = parseCanonicalWorkspaceLocator(target.kind === 'workspace-root' ? target.workspaceId : target.root)
  if (!expected) return null
  return expected.path
}
