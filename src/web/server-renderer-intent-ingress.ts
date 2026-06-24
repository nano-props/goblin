import { isRendererEffectIntent, type RendererEffectIntent } from '#/shared/renderer-effect-intents.ts'
import { createServerWebSocketIngress } from '#/web/lib/server-ws-ingress.ts'

// Server-controlled ingress for renderer effect intents (e.g. those
// dispatched by `g delta` from a Goblin PTY). Renderer-side counterpart
// to `#/server/modules/renderer-intent-broker.ts` and
// `#/server/routes/realtime.ts` (`/ws/renderer-intent`). The server
// fans intents out as envelopes of the form
//
//   { type: 'renderer-effect-intent', intent: RendererEffectIntent }
//
// The envelope wraps `RendererEffectIntent` so the same wire format
// can later carry additional control messages without collision with
// data-plane invalidations on `/ws/invalidation`.

interface RendererIntentEnvelope {
  type: 'renderer-effect-intent'
  intent: unknown
}

function parseRendererIntentMessage(data: unknown): RendererEffectIntent | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const envelope = parsed as Partial<RendererIntentEnvelope>
  if (envelope.type !== 'renderer-effect-intent') return null
  if (!isRendererEffectIntent(envelope.intent)) return null
  return envelope.intent
}

const ingress = createServerWebSocketIngress<RendererEffectIntent>({
  path: '/ws/renderer-intent',
  parseMessage: parseRendererIntentMessage,
})

export const subscribeServerRendererIntentIngress = ingress.subscribe
export const resetServerRendererIntentIngressForTests = ingress.resetForTests
