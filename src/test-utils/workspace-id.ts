import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export function workspaceIdForTest(value: string): WorkspaceId {
  const workspaceId = canonicalWorkspaceLocator(value)
  if (!workspaceId) throw new Error(`invalid test workspace id: ${value}`)
  return workspaceId
}
