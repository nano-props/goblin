import { isServerInvalidationEvent, type ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import { createServerWebSocketIngress } from '#/web/lib/server-ws-ingress.ts'

// Server-owned invalidation ingress for browser clients.

function parseInvalidationMessage(data: unknown): ServerInvalidationEvent | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = JSON.parse(data) as unknown
    return isServerInvalidationEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

const ingress = createServerWebSocketIngress<ServerInvalidationEvent>({
  path: '/ws/invalidation',
  parseMessage: parseInvalidationMessage,
})

export const subscribeServerInvalidationIngress = ingress.subscribe
export const resetServerInvalidationIngressForTests = ingress.resetForTests
