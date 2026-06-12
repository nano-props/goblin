import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import type { SettingsInvalidationEvent, SettingsInvalidationScope } from '#/shared/server-invalidation.ts'

interface InvalidationSocket {
  send(data: string): unknown
  close(code?: number, reason?: string): unknown
}

const sockets = new Set<InvalidationSocket>()

function publishInvalidationPayload(payload: string): void {
  if (sockets.size === 0) return
  for (const socket of Array.from(sockets)) {
    try {
      socket.send(payload)
    } catch {
      unregisterInvalidationSocket(socket)
    }
  }
}

export function registerInvalidationSocket(ws: InvalidationSocket): void {
  sockets.add(ws)
}

export function unregisterInvalidationSocket(ws: InvalidationSocket): void {
  sockets.delete(ws)
}

export function disconnectAllInvalidationSockets(): void {
  for (const socket of Array.from(sockets)) {
    try {
      socket.close(1001, 'server shutting down')
    } catch {}
  }
  sockets.clear()
}

export function publishRepoQueryInvalidation(event: Omit<RepoQueryInvalidationEvent, 'type'>): void {
  publishInvalidationPayload(
    JSON.stringify({ type: 'repo-query-invalidated', ...event } satisfies RepoQueryInvalidationEvent),
  )
}

export function publishSettingsInvalidation(scopes: SettingsInvalidationScope[]): void {
  if (scopes.length === 0) return
  publishInvalidationPayload(
    JSON.stringify({ type: 'settings-invalidated', scopes } satisfies SettingsInvalidationEvent),
  )
}
