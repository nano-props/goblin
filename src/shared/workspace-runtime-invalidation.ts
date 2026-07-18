import { canonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'

export interface WorkspaceRuntimeInvalidationEvent {
  type: 'workspace-runtime-invalidated'
  workspaceId: WorkspaceId
}

export function isWorkspaceRuntimeInvalidationEvent(value: unknown): value is WorkspaceRuntimeInvalidationEvent {
  if (!value || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  const workspaceId = Reflect.get(value, 'workspaceId')
  return (
    type === 'workspace-runtime-invalidated' &&
    typeof workspaceId === 'string' &&
    canonicalWorkspaceLocator(workspaceId) !== null
  )
}
