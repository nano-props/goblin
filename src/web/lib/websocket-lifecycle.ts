export type WebSocketLifecyclePhase = 'connecting' | 'open' | 'closing'

export interface WebSocketLifecycleEntry<TConnection> {
  socket: WebSocket
  generation: number
  connection: TConnection
  phase: WebSocketLifecyclePhase
  closeWhenIdle: boolean
}

export interface WebSocketLifecycleDisconnectContext {
  reason: string
  idleClose: boolean
  event?: Event
}

export interface WebSocketLifecycleOptions<TConnection> {
  resolveConnection: () => TConnection | null
  createSocket: (connection: TConnection) => WebSocket
  shouldOpen: () => boolean
  shouldKeepOpen: () => boolean
  closeReason?: string
  errorReason?: string
  onOpen?: (entry: WebSocketLifecycleEntry<TConnection>) => void
  onMessage?: (event: MessageEvent, entry: WebSocketLifecycleEntry<TConnection>) => void
  onDisconnect?: (
    entry: WebSocketLifecycleEntry<TConnection>,
    context: WebSocketLifecycleDisconnectContext,
  ) => void
  onUnavailableSocketDropped?: (entry: WebSocketLifecycleEntry<TConnection>) => void
}

export interface WebSocketLifecycle<TConnection> {
  active: () => WebSocketLifecycleEntry<TConnection> | null
  ensureSocket: () => WebSocketLifecycleEntry<TConnection> | null
  isActive: (socket: WebSocket, generation: number) => boolean
  cancelIdleClose: () => void
  requestIdleClose: () => boolean
  disconnect: (reason: string, socket?: WebSocket | null) => void
  forgetUnavailableSocket: () => void
  closeAndForget: () => void
}

export function createWebSocketLifecycle<TConnection>(
  options: WebSocketLifecycleOptions<TConnection>,
): WebSocketLifecycle<TConnection> {
  const closeReason = options.closeReason ?? 'socket closed'
  const errorReason = options.errorReason ?? 'socket error'
  let activeEntry: WebSocketLifecycleEntry<TConnection> | null = null
  let socketGeneration = 0

  function active(): WebSocketLifecycleEntry<TConnection> | null {
    return activeEntry
  }

  function isActive(socket: WebSocket, generation: number): boolean {
    return activeEntry?.socket === socket && activeEntry.generation === generation
  }

  function ensureSocket(): WebSocketLifecycleEntry<TConnection> | null {
    forgetUnavailableSocket()
    if (activeEntry || !options.shouldOpen()) return activeEntry
    const connection = options.resolveConnection()
    if (!connection) return null
    const generation = (socketGeneration += 1)
    const socket = options.createSocket(connection)
    const entry: WebSocketLifecycleEntry<TConnection> = {
      socket,
      generation,
      connection,
      phase: 'connecting',
      closeWhenIdle: false,
    }
    activeEntry = entry

    socket.addEventListener('open', () => {
      if (!isActive(socket, generation)) return
      entry.phase = 'open'
      if (entry.closeWhenIdle && !options.shouldKeepOpen()) {
        closeEntry(entry)
        return
      }
      options.onOpen?.(entry)
    })
    socket.addEventListener('message', (event) => {
      if (!isActive(socket, generation)) return
      options.onMessage?.(event, entry)
    })
    socket.addEventListener('close', (event) => {
      if (!isActive(socket, generation)) return
      handleDisconnect(entry, closeReason, event)
    })
    socket.addEventListener('error', (event) => {
      if (!isActive(socket, generation)) return
      handleDisconnect(entry, errorReason, event)
    })

    return entry
  }

  function cancelIdleClose(): void {
    if (activeEntry) activeEntry.closeWhenIdle = false
  }

  function requestIdleClose(): boolean {
    const entry = activeEntry
    if (!entry || options.shouldKeepOpen()) return false
    entry.closeWhenIdle = true
    if (entry.socket.readyState === WebSocket.CONNECTING) return true
    closeEntry(entry)
    return true
  }

  function disconnect(reason: string, socket: WebSocket | null = activeEntry?.socket ?? null): void {
    const entry = activeEntry
    if (!entry || entry.socket !== socket) return
    handleDisconnect(entry, reason)
    closeEntry(entry)
  }

  function forgetUnavailableSocket(): void {
    const entry = activeEntry
    if (!entry) return
    if (entry.socket.readyState !== WebSocket.CLOSING && entry.socket.readyState !== WebSocket.CLOSED) return
    activeEntry = null
    entry.phase = 'closing'
    options.onUnavailableSocketDropped?.(entry)
  }

  function closeAndForget(): void {
    const entry = activeEntry
    activeEntry = null
    if (!entry) return
    closeEntry(entry)
  }

  function closeEntry(entry: WebSocketLifecycleEntry<TConnection>): void {
    entry.phase = 'closing'
    try {
      entry.socket.close()
    } catch {}
  }

  function handleDisconnect(entry: WebSocketLifecycleEntry<TConnection>, reason: string, event?: Event): void {
    if (activeEntry !== entry) return
    activeEntry = null
    entry.phase = 'closing'
    options.onDisconnect?.(entry, { reason, idleClose: entry.closeWhenIdle, event })
  }

  return {
    active,
    ensureSocket,
    isActive,
    cancelIdleClose,
    requestIdleClose,
    disconnect,
    forgetUnavailableSocket,
    closeAndForget,
  }
}
