import { broadcastRpcEvent } from '#/main/events.ts'
import { toSafeSessionPath } from '#/shared/input-validation.ts'

const queuedPaths = new Set<string>()

export function enqueueExternalOpenPath(path: unknown): boolean {
  const safePath = toSafeSessionPath(path)
  if (!safePath || queuedPaths.has(safePath)) return false
  queuedPaths.add(safePath)
  broadcastRpcEvent({ type: 'external-open-enqueued' })
  return true
}

export function consumeExternalOpenPaths(): string[] {
  const paths = Array.from(queuedPaths)
  queuedPaths.clear()
  return paths
}
