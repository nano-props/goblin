import {
  isWorkspaceFilesystemInvalidationEvent,
  type WorkspaceFilesystemInvalidationEvent,
} from '#/shared/workspace-filesystem-invalidation.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

export function subscribeWorkspaceFilesystemInvalidation(
  listener: (event: WorkspaceFilesystemInvalidationEvent) => void,
): () => void {
  return subscribeServerInvalidationIngress((event) => {
    if (isWorkspaceFilesystemInvalidationEvent(event)) listener(event)
  })
}
