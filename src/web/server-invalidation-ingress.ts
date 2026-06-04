import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { isServerInvalidationEvent, type ServerInvalidationEvent } from '#/shared/server-invalidation.ts'
import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'

type Listener = (event: ServerInvalidationEvent) => void
// Shared server-owned invalidation ingress for browser and Electron renderers.
// This is distinct from native-host ingress (`renderer-ingress.ts`), which is
// only for Electron IPC-driven events/intents.

const listeners = new Set<Listener>()
let socket: WebSocket | null = null
let manualSocketClose = false
let socketGeneration = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const INVALIDATION_RECONNECT_DELAY_MS = 300

function createInvalidationWebSocketUrl(baseUrl: string, secret: string): string {
  const httpUrl = new URL('/ws/invalidation', baseUrl)
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  httpUrl.searchParams.set('token', secret)
  return httpUrl.toString()
}

function parseInvalidationMessage(data: unknown): ServerInvalidationEvent | null {
  if (typeof data !== 'string') return null
  try {
    const parsed = JSON.parse(data) as unknown
    return isServerInvalidationEvent(parsed) ? parsed : null
  } catch {
    return null
  }
}

function ensureSocket(): void {
  const server = getInitialBootstrap().initialServer
  if (!server || typeof WebSocket === 'undefined' || socket || listeners.size === 0 || isAppQuitting()) return
  clearReconnectTimer()
  manualSocketClose = false
  const generation = (socketGeneration += 1)
  const currentSocket = new WebSocket(createInvalidationWebSocketUrl(server.url, server.secret))
  socket = currentSocket
  currentSocket.addEventListener('open', () => {
    if (socket !== currentSocket || socketGeneration !== generation) return
    if (manualSocketClose && listeners.size === 0) {
      try {
        currentSocket.close()
      } catch {}
    }
  })
  currentSocket.addEventListener('message', (event) => {
    if (socket !== currentSocket || socketGeneration !== generation) return
    const payload = parseInvalidationMessage(event.data)
    if (!payload) return
    for (const listener of listeners) listener(payload)
  })
  const cleanup = () => {
    if (socket !== currentSocket || socketGeneration !== generation) return
    const wasManual = manualSocketClose
    socket = null
    manualSocketClose = false
    if (wasManual) {
      if (listeners.size > 0) ensureSocket()
      return
    }
    scheduleReconnect()
  }
  currentSocket.addEventListener('close', cleanup)
  currentSocket.addEventListener('error', cleanup)
}

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return
  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || listeners.size === 0 || isAppQuitting()) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    ensureSocket()
  }, INVALIDATION_RECONNECT_DELAY_MS)
}

function maybeCloseSocket(): void {
  if (listeners.size > 0 || !socket) return
  manualSocketClose = true
  clearReconnectTimer()
  if (socket.readyState === WebSocket.CONNECTING) return
  try {
    socket.close()
  } catch {}
}

export function subscribeServerInvalidationIngress(listener: Listener): () => void {
  listeners.add(listener)
  manualSocketClose = false
  ensureSocket()
  return () => {
    listeners.delete(listener)
    maybeCloseSocket()
  }
}

export function resetServerInvalidationIngressForTests(): void {
  listeners.clear()
  manualSocketClose = false
  clearReconnectTimer()
  if (socket) {
    try {
      socket.close()
    } catch {}
  }
  socket = null
}

function closeSocketForQuit(): void {
  manualSocketClose = true
  clearReconnectTimer()
  const currentSocket = socket
  socket = null
  if (!currentSocket) return
  try {
    currentSocket.close()
  } catch {}
}

subscribeAppQuitting(() => {
  closeSocketForQuit()
})
