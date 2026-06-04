import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { isRepoQueryInvalidationEvent, type RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

type Listener = (event: RepoQueryInvalidationEvent) => void

export function subscribeRepoQueryInvalidation(listener: Listener): () => void {
  return subscribeRepoQueryInvalidationIngress(listener)
}

function subscribeRepoQueryInvalidationIngress(listener: Listener): () => void {
  const server = getInitialBootstrap().initialServer
  if (!server || typeof WebSocket === 'undefined') return () => {}
  return subscribeServerInvalidationIngress((event) => {
    if (isRepoQueryInvalidationEvent(event)) listener(event)
  })
}
