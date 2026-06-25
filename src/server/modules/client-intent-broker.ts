import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'

interface ClientIntentSocket {
  send(data: string): unknown
  close(code?: number, reason?: string): unknown
}

// Cap the number of concurrent client-intent subscribers. Same
// rationale as `invalidation-broker.ts`: a hostile client that
// keeps opening `/ws/client-intent` connections shouldn't pin
// file descriptors or fanout cost in the server. 32 is generous
// for a desktop app with at most a few tabs / windows.
export const MAX_RENDERER_INTENT_SOCKETS = 32

export class ClientIntentSocketLimitError extends Error {
  constructor() {
    super(`Too many client-intent subscribers (max ${MAX_RENDERER_INTENT_SOCKETS})`)
    this.name = 'ClientIntentSocketLimitError'
  }
}

const sockets = new Set<ClientIntentSocket>()

export function registerClientIntentSocket(ws: ClientIntentSocket): void {
  if (sockets.size >= MAX_RENDERER_INTENT_SOCKETS) {
    throw new ClientIntentSocketLimitError()
  }
  sockets.add(ws)
}

export function unregisterClientIntentSocket(ws: ClientIntentSocket): void {
  sockets.delete(ws)
}

export function disconnectAllClientIntentSockets(): void {
  for (const socket of Array.from(sockets)) {
    try {
      socket.close(1001, 'server shutting down')
    } catch {}
  }
  sockets.clear()
}

// Broadcast a client effect intent to every subscriber. Returns
// `false` when no client is currently subscribed — callers
// (notably `POST /api/repo/view`) translate that into a 503 so the
// CLI prints a clear error instead of silently doing nothing.
//
// We deliberately broadcast (no per-ownerId routing) because the
// view-switching intents we publish here are non-sensitive
// ("switch to the changes tab") and the broadcast matches the
// invalidation broker's fanout semantics. If a future intent needs
// per-owner routing, layer it on top — but don't repurpose this
// broker; the simpler shape is the right default.
export function publishRendererIntent(intent: ClientEffectIntent): boolean {
  if (sockets.size === 0) return false
  const payload = JSON.stringify({ type: 'client-effect-intent', intent })
  for (const socket of Array.from(sockets)) {
    try {
      socket.send(payload)
    } catch {
      unregisterClientIntentSocket(socket)
    }
  }
  return true
}
