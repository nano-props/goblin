import { isRepoReadInvalidationEvent, type RepoReadInvalidationEvent } from '#/shared/repo-read-invalidation.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

type Listener = (event: RepoReadInvalidationEvent) => void

export function subscribeRepoReadInvalidation(listener: Listener): () => void {
  return subscribeRepoReadInvalidationIngress(listener)
}

function subscribeRepoReadInvalidationIngress(listener: Listener): () => void {
  return subscribeServerInvalidationIngress((event) => {
    if (isRepoReadInvalidationEvent(event)) listener(event)
  })
}
