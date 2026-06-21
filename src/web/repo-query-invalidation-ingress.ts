import { isRepoQueryInvalidationEvent, type RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

type Listener = (event: RepoQueryInvalidationEvent) => void

export function subscribeRepoQueryInvalidation(listener: Listener): () => void {
  return subscribeRepoQueryInvalidationIngress(listener)
}

function subscribeRepoQueryInvalidationIngress(listener: Listener): () => void {
  return subscribeServerInvalidationIngress((event) => {
    if (isRepoQueryInvalidationEvent(event)) listener(event)
  })
}
