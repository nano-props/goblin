import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { subscribeServerInvalidation } from '#/web/server-invalidation-source.ts'
import { isSettingsInvalidationEvent, type SettingsInvalidationEvent } from '#/shared/server-invalidation.ts'
type Listener = (event: SettingsInvalidationEvent) => void

export function subscribeSettingsInvalidation(listener: Listener): () => void {
  const server = getInitialBootstrap().initialServer
  if (!server || typeof WebSocket === 'undefined') return () => {}
  return subscribeServerInvalidation((event) => {
    if (isSettingsInvalidationEvent(event)) listener(event)
  })
}
