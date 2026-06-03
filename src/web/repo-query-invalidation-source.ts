import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { isRepoQueryInvalidationEvent, type RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { subscribeServerInvalidation } from '#/web/server-invalidation-source.ts'
type Listener = (event: RepoQueryInvalidationEvent) => void

export function subscribeRepoQueryInvalidation(listener: Listener): () => void {
  return subscribeServerInvalidationStream(listener)
}

function subscribeServerInvalidationStream(listener: Listener): () => void {
  const server = getInitialBootstrap().initialServer
  if (!server || typeof WebSocket === 'undefined') return () => {}
  return subscribeServerInvalidation((event) => {
    if (isRepoQueryInvalidationEvent(event)) listener(event)
  })
}
