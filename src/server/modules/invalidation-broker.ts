import type { RepoQueryInvalidationEvent } from '#/shared/repo-query-invalidation.ts'
import type { WorkspaceRuntimeInvalidationEvent } from '#/shared/workspace-runtime-invalidation.ts'
import type { WorkspaceFilesystemInvalidationEvent } from '#/shared/workspace-filesystem-invalidation.ts'
import type { SettingsInvalidationEvent, SettingsInvalidationScope } from '#/shared/server-invalidation.ts'

interface InvalidationSocket {
  send(data: string): unknown
  close(code?: number, reason?: string): unknown
}

// Cap the number of concurrent invalidation subscribers. Each open
// socket ties up a file descriptor and a broker send, so a hostile
// client that keeps opening /ws/invalidation connections can DoS the
// server without this. 32 is generous for a desktop app (one tab + a
// few background subscriptions is the realistic max) and small
// enough that a flood is rejected before it costs anything.
export const MAX_INVALIDATION_SOCKETS = 32

export class InvalidationSocketLimitError extends Error {
  constructor() {
    super(`Too many invalidation subscribers (max ${MAX_INVALIDATION_SOCKETS})`)
    this.name = 'InvalidationSocketLimitError'
  }
}

const sockets = new Map<InvalidationSocket, string | null>()

function publishInvalidationPayload(payload: string, userId?: string): void {
  if (sockets.size === 0) return
  for (const [socket, ownerId] of Array.from(sockets)) {
    if (userId && ownerId !== userId) continue
    try {
      socket.send(payload)
    } catch {
      unregisterInvalidationSocket(socket)
    }
  }
}

export function registerInvalidationSocket(ws: InvalidationSocket, userId?: string): void {
  if (sockets.size >= MAX_INVALIDATION_SOCKETS) {
    throw new InvalidationSocketLimitError()
  }
  sockets.set(ws, userId ?? null)
}

export function unregisterInvalidationSocket(ws: InvalidationSocket): void {
  sockets.delete(ws)
}

export function disconnectAllInvalidationSockets(): void {
  for (const socket of Array.from(sockets.keys())) {
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

export function publishUserRepoQueryInvalidation(
  userId: string,
  event: Omit<RepoQueryInvalidationEvent, 'type'>,
): void {
  publishInvalidationPayload(
    JSON.stringify({ type: 'repo-query-invalidated', ...event } satisfies RepoQueryInvalidationEvent),
    userId,
  )
}

export function publishUserWorkspaceRuntimeInvalidation(
  userId: string,
  event: Omit<WorkspaceRuntimeInvalidationEvent, 'type'>,
): void {
  publishInvalidationPayload(
    JSON.stringify({ type: 'workspace-runtime-invalidated', ...event } satisfies WorkspaceRuntimeInvalidationEvent),
    userId,
  )
}

export function publishUserWorkspaceFilesystemInvalidation(
  userId: string,
  event: Omit<WorkspaceFilesystemInvalidationEvent, 'type'>,
): void {
  publishInvalidationPayload(
    JSON.stringify({
      type: 'workspace-filesystem-invalidated',
      ...event,
    } satisfies WorkspaceFilesystemInvalidationEvent),
    userId,
  )
}

export function publishSettingsInvalidation(scopes: SettingsInvalidationScope[]): void {
  if (scopes.length === 0) return
  publishInvalidationPayload(
    JSON.stringify({ type: 'settings-invalidated', scopes } satisfies SettingsInvalidationEvent),
  )
}
