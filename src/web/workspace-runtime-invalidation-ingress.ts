import {
  isWorkspaceRuntimeInvalidationEvent,
  type WorkspaceRuntimeInvalidationEvent,
} from '#/shared/workspace-runtime-invalidation.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

export function subscribeWorkspaceRuntimeInvalidation(
  listener: (event: WorkspaceRuntimeInvalidationEvent) => void,
): () => void {
  return subscribeServerInvalidationIngress((event) => {
    if (isWorkspaceRuntimeInvalidationEvent(event)) listener(event)
  })
}
