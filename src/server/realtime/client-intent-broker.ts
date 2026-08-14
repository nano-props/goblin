import type { RepoViewClientIntent } from '#/shared/client-effect-intents.ts'

interface ClientIntentSocket {
  send(data: string): unknown
  close(code?: number, reason?: string): unknown
}

// Cap the number of concurrent client-intent subscribers. Same
// rationale as `invalidation-broker.ts`: a hostile client that
// keeps opening `/ws/client-intent` connections shouldn't pin
// file descriptors or fanout cost in the server. 32 is generous
// for a desktop app with at most a few tabs / windows.
export const MAX_CLIENT_INTENT_SOCKETS = 32

export class ClientIntentSocketLimitError extends Error {
  constructor() {
    super(`Too many client-intent subscribers (max ${MAX_CLIENT_INTENT_SOCKETS})`)
    this.name = 'ClientIntentSocketLimitError'
  }
}

const sockets = new Set<ClientIntentSocket>()

export function registerClientIntentSocket(ws: ClientIntentSocket): void {
  if (sockets.size >= MAX_CLIENT_INTENT_SOCKETS) {
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
// The only server-originated intent is a non-sensitive view switch, so it is
// broadcast with the same fanout semantics as invalidations.
export function publishClientIntent(intent: RepoViewClientIntent): boolean {
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
