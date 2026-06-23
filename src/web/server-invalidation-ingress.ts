import { isServerInvalidationEvent, type ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import { createServerWebSocketIngress } from '#/web/lib/server-ws-ingress.ts'

// Shared server-owned invalidation ingress for browser and Electron
// renderers. Distinct from native-host ingress (`renderer-ingress.ts`),
// which is for Electron IPC-driven events/intents only.

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
