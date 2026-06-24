import type { ClientEffectIntent } from '#/shared/client-effect-intents.ts'

interface RendererIntentSocket {
  send(data: string): unknown
  close(code?: number, reason?: string): unknown
}

// Cap the number of concurrent renderer-intent subscribers. Same
// rationale as `invalidation-broker.ts`: a hostile client that
// keeps opening `/ws/renderer-intent` connections shouldn't pin
// file descriptors or fanout cost in the server. 32 is generous
// for a desktop app with at most a few tabs / windows.
export const MAX_RENDERER_INTENT_SOCKETS = 32

export class RendererIntentSocketLimitError extends Error {
  constructor() {
    super(`Too many renderer-intent subscribers (max ${MAX_RENDERER_INTENT_SOCKETS})`)
    this.name = 'RendererIntentSocketLimitError'
  }
}

const sockets = new Set<RendererIntentSocket>()

export function registerRendererIntentSocket(ws: RendererIntentSocket): void {
  if (sockets.size >= MAX_RENDERER_INTENT_SOCKETS) {
    throw new RendererIntentSocketLimitError()
  }
  sockets.add(ws)
}

export function unregisterRendererIntentSocket(ws: RendererIntentSocket): void {
  sockets.delete(ws)
}

export function disconnectAllRendererIntentSockets(): void {
  for (const socket of Array.from(sockets)) {
    try {
      socket.close(1001, 'server shutting down')
    } catch {}
  }
  sockets.clear()
}

// Broadcast a renderer effect intent to every subscriber. Returns
// `false` when no renderer is currently subscribed — callers
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
  const payload = JSON.stringify({ type: 'renderer-effect-intent', intent })
  for (const socket of Array.from(sockets)) {
    try {
      socket.send(payload)
    } catch {
      unregisterRendererIntentSocket(socket)
    }
  }
  return true
}
