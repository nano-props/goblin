import { parseWorkspaceLocator } from '#/shared/workspace-locator.ts'

/** Resolve the workspace-level target at the native execution boundary. */
export function resolveWorkspaceScopedPath(workspaceId: string, target: string): string | null {
  if (target !== workspaceId) return null
  const locator = parseWorkspaceLocator(workspaceId, process.platform === 'win32' ? 'win32' : 'posix')
  return locator?.path ?? null
}
