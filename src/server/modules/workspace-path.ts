import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'

/** Decode a canonical local workspace identity only where native filesystem
 * execution begins. Runtime and persistence layers must keep the locator. */
export function localWorkspaceNativePath(workspaceId: string): string | null {
  const locator = parseWorkspaceLocator(workspaceId, process.platform === 'win32' ? 'win32' : 'posix')
  return locator?.transport === 'file' ? locator.path : null
}

/** Resolve the workspace-level target at the native execution boundary. */
export function resolveWorkspaceScopedPath(workspaceId: string, target: string): string | null {
  if (target !== workspaceId) return null
  return localWorkspaceNativePath(workspaceId)
}
