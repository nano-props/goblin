import { isRepoViewClientIntent, type RepoViewClientIntent } from '#/shared/client-effect-intents.ts'
import { createServerWebSocketIngress } from '#/web/lib/server-ws-ingress.ts'

// Server-controlled ingress for repo-view navigation requested by commands
// such as `g delta` in a Goblin PTY. Client-side counterpart to
// `#/server/modules/client-intent-broker.ts` and the `/ws/client-intent`
// realtime route. The server sends envelopes of the form
//
//   { type: 'client-effect-intent', intent: RepoViewClientIntent }

interface ClientIntentEnvelope {
  type: 'client-effect-intent'
  intent: unknown
}

function parseServerClientIntentMessage(data: unknown): RepoViewClientIntent | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const envelope = parsed as Partial<ClientIntentEnvelope>
  if (envelope.type !== 'client-effect-intent') return null
  if (!isRepoViewClientIntent(envelope.intent)) return null
  return envelope.intent
}

const ingress = createServerWebSocketIngress<RepoViewClientIntent>({
  path: '/ws/client-intent',
  parseMessage: parseServerClientIntentMessage,
})

export const subscribeServerClientIntentIngress = ingress.subscribe
export const resetServerClientIntentIngressForTests = ingress.resetForTests
