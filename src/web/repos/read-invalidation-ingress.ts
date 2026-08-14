import { isRepoReadInvalidationEvent, type RepoReadInvalidationEvent } from '#/shared/repo-read-invalidation.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'

type Listener = (event: RepoReadInvalidationEvent) => void

export function subscribeRepoReadInvalidation(listener: Listener, onOpen?: () => void): () => void {
  return subscribeRepoReadInvalidationIngress(listener, onOpen)
}

function subscribeRepoReadInvalidationIngress(listener: Listener, onOpen?: () => void): () => void {
  return subscribeServerInvalidationIngress((event) => {
    if (isRepoReadInvalidationEvent(event)) listener(event)
  }, onOpen)
}
