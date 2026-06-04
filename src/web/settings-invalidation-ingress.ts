import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { subscribeServerInvalidationIngress } from '#/web/server-invalidation-ingress.ts'
import { isSettingsInvalidationEvent, type SettingsInvalidationEvent } from '#/shared/server-invalidation.ts'

type Listener = (event: SettingsInvalidationEvent) => void

export function subscribeSettingsInvalidation(listener: Listener): () => void {
  const server = getInitialBootstrap().initialServer
  if (!server || typeof WebSocket === 'undefined') return () => {}
  return subscribeServerInvalidationIngress((event) => {
    if (isSettingsInvalidationEvent(event)) listener(event)
  })
}
