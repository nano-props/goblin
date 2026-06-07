import { emitRendererLocalEvent } from '#/web/local-events.ts'
import { resolveApiBaseUrl, resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'
import {
  normalizeTerminalRealtimeMessage,
  normalizeTerminalSessionSnapshot,
  normalizeTerminalSessionSummaryList,
  resolveTerminalOwnership,
} from '#/shared/terminal.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalListSessionsInput,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalRealtimeMessage,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverResult,
  TerminalTitleEvent,
} from '#/shared/terminal.ts'
import type { RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'
import type { TerminalOwnershipViewModel } from '#/web/components/terminal/types.ts'
import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'

export interface RendererServerTerminalConfig {
  url: string
  secret: string
  clientId: string
}

const WEB_TERMINAL_ATTACHMENT_ID_STORAGE_KEY = 'goblin:web-terminal-attachment-id'

export function createServerTerminalBridge(options: {
  getServerConfig: () => RendererServerTerminalConfig
  getAttachmentId: () => string
  notifyBell?: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification?: () => Promise<boolean>
  setBadge?: (count: number) => void
}): RendererTerminalBridge {
  const outputSubscribers = new Set<(event: TerminalOutputEvent) => void>()
  const titleSubscribers = new Set<(event: TerminalTitleEvent) => void>()
  const exitSubscribers = new Set<(event: TerminalExitEvent) => void>()
  const ownershipSubscribers = new Set<
    (event: TerminalOwnershipViewModel) => void
  >()
  const sessionsChangedSubscribers = new Set<(repoRoot: string) => void>()
  const attachmentId = options.getAttachmentId()
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null
  let manualSocketClose = false
  let socketGeneration = 0
  let quitting = isAppQuitting()

  function hasSubscribers(): boolean {
    return (
      outputSubscribers.size > 0 ||
      titleSubscribers.size > 0 ||
      exitSubscribers.size > 0 ||
      ownershipSubscribers.size > 0 ||
      sessionsChangedSubscribers.size > 0
    )
  }

  function isActiveSocket(currentSocket: WebSocket, generation: number): boolean {
    return socket === currentSocket && socketGeneration === generation
  }

  async function fetchTerminalJson<T>(path: string, body: object): Promise<T> {
    const server = options.getServerConfig()
    const response = await fetch(new URL(path, resolveApiBaseUrl(server.url)).toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goblin-internal-secret': server.secret,
      },
      body: JSON.stringify({ clientId: server.clientId, ...body }),
    })
    if (!response.ok) throw new Error(`Server request failed: HTTP ${response.status}`)
    return (await response.json()) as T
  }

  function clearReconnectTimer() {
    if (reconnectTimer === null) return
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null || !hasSubscribers() || quitting) {
      return
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      ensureSocket()
    }, 300)
  }

  function ensureSocket() {
    if (socket || typeof WebSocket === 'undefined' || quitting) return
    let socketUrl: string
    try {
      const server = options.getServerConfig()
      socketUrl = createTerminalWebSocketUrl(server.url, server.secret, server.clientId, attachmentId)
    } catch {
      return
    }
    manualSocketClose = false
    const generation = (socketGeneration += 1)
    const currentSocket = new WebSocket(socketUrl)
    socket = currentSocket
    currentSocket.addEventListener('open', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      if (manualSocketClose && !hasSubscribers()) {
        try {
          currentSocket.close()
        } catch {}
      }
    })
    currentSocket.addEventListener('message', (event) => {
      if (!isActiveSocket(currentSocket, generation)) return
      const message = parseTerminalRealtimeMessage(event.data)
      if (!message) return
      if (message.type === 'output') {
        for (const subscriber of outputSubscribers) subscriber(message.event)
      } else if (message.type === 'title') {
        for (const subscriber of titleSubscribers) subscriber(message.event)
      } else if (message.type === 'exit') {
        for (const subscriber of exitSubscribers) subscriber(message.event)
      } else if (message.type === 'sessions-changed') {
        for (const subscriber of sessionsChangedSubscribers) subscriber(message.repoRoot)
      } else {
        const ownershipEvent = {
          sessionId: message.event.sessionId,
          ...resolveTerminalOwnership(message.event.controller, attachmentId),
          canonicalCols: message.event.cols,
          canonicalRows: message.event.rows,
        }
        for (const subscriber of ownershipSubscribers) subscriber(ownershipEvent)
      }
    })
    currentSocket.addEventListener('close', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      const wasManual = manualSocketClose
      socket = null
      manualSocketClose = false
      if (wasManual) {
        if (hasSubscribers()) ensureSocket()
        return
      }
      scheduleReconnect()
    })
    currentSocket.addEventListener('error', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      try {
        currentSocket.close()
      } catch {}
    })
  }

  function maybeCloseSocket() {
    if (hasSubscribers() || !socket) return
    manualSocketClose = true
    clearReconnectTimer()
    if (socket.readyState === WebSocket.CONNECTING) return
    try {
      socket.close()
    } catch {}
  }

  subscribeAppQuitting(() => {
    quitting = true
    manualSocketClose = true
    clearReconnectTimer()
    const currentSocket = socket
    socket = null
    if (!currentSocket) return
    try {
      currentSocket.close()
    } catch {}
  })

  return {
    attach(input) {
      ensureSocket()
      return fetchTerminalJson<TerminalAttachResult>('/api/terminal/attach', {
        ...(input satisfies TerminalAttachInput),
        attachmentId,
      })
    },
    restart(input) {
      ensureSocket()
      return fetchTerminalJson<TerminalAttachResult>('/api/terminal/restart', { ...input, attachmentId })
    },
    write(input) {
      return fetchTerminalJson<TerminalMutationResult>('/api/terminal/write', { ...input, attachmentId })
    },
    resize(input) {
      return fetchTerminalJson<TerminalMutationResult>('/api/terminal/resize', { ...input, attachmentId })
    },
    takeover(input) {
      return fetchTerminalJson<TerminalTakeoverResult>('/api/terminal/takeover', { ...input, attachmentId })
    },
    close(input) {
      return fetchTerminalJson<TerminalMutationResult>('/api/terminal/close', input)
    },
    create(input) {
      return fetchTerminalJson<TerminalCatalogMutationResult>('/api/terminal/create', {
        ...(input satisfies TerminalCreateInput),
        attachmentId,
      })
    },
    pruneTerminals(repoRoot) {
      return fetchTerminalJson<{ pruned: number; remaining: number }>('/api/terminal/prune', { repoRoot })
    },
    listSessions(input) {
      return fetchTerminalJson<unknown>('/api/terminal/list-sessions', input satisfies TerminalListSessionsInput).then((value) => {
        const sessions = normalizeTerminalSessionSummaryList(value)
        if (!sessions) throw new Error('Server request failed: invalid terminal sessions response')
        return sessions
      })
    },
    getSessionSnapshot(input) {
      return fetchTerminalJson<unknown>('/api/terminal/session-snapshot', input satisfies TerminalSessionSnapshotInput).then((value) => {
        if (value === null) return null
        const snapshot = normalizeTerminalSessionSnapshot(value)
        if (!snapshot) throw new Error('Server request failed: invalid terminal session snapshot response')
        return snapshot
      })
    },
    notifyBell(input) {
      if (options.notifyBell) return options.notifyBell(input)
      return showBrowserNotification(input.title, input.body, () => {
        emitRendererLocalEvent({ type: 'terminal-bell-click', repoRoot: input.repoRoot, key: input.key })
      })
    },
    sendTestNotification() {
      return options.sendTestNotification?.() ?? showBrowserNotification('Goblin', 'Test notification')
    },
    setBadge(count) {
      options.setBadge?.(count)
    },
    onOutput(cb) {
      outputSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        outputSubscribers.delete(cb)
        maybeCloseSocket()
      }
    },
    onTitle(cb) {
      titleSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        titleSubscribers.delete(cb)
        maybeCloseSocket()
      }
    },
    onExit(cb) {
      exitSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        exitSubscribers.delete(cb)
        maybeCloseSocket()
      }
    },
    onOwnership(cb) {
      ownershipSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        ownershipSubscribers.delete(cb)
        maybeCloseSocket()
      }
    },
    onSessionsChanged(cb) {
      sessionsChangedSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        sessionsChangedSubscribers.delete(cb)
        maybeCloseSocket()
      }
    },
  }
}

export function createTerminalWebSocketUrl(baseUrl: string, secret: string, clientId: string, attachmentId: string): string {
  const httpUrl = new URL('/ws/terminal', baseUrl)
  httpUrl.protocol = resolveWebSocketProtocol()
  httpUrl.searchParams.set('token', secret)
  httpUrl.searchParams.set('clientId', clientId)
  httpUrl.searchParams.set('attachmentId', attachmentId)
  return httpUrl.toString()
}

export function parseTerminalRealtimeMessage(data: unknown): TerminalRealtimeMessage | null {
  if (typeof data !== 'string') return null
  try {
    return normalizeTerminalRealtimeMessage(JSON.parse(data))
  } catch {}
  return null
}

export function readOrCreateWebTerminalAttachmentId(): string {
  const fallback = `attachment_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  try {
    const storage = window.sessionStorage
    const existing = storage?.getItem(WEB_TERMINAL_ATTACHMENT_ID_STORAGE_KEY)?.trim()
    if (existing) return existing
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `attachment_${crypto.randomUUID().replace(/-/g, '')}`
        : fallback
    storage?.setItem(WEB_TERMINAL_ATTACHMENT_ID_STORAGE_KEY, created)
    return created
  } catch {
    return fallback
  }
}

async function showBrowserNotification(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  let permission = Notification.permission
  if (permission !== 'granted') {
    if (permission === 'denied') return false
    try {
      permission = await Notification.requestPermission()
    } catch {
      return false
    }
  }
  if (permission !== 'granted') return false
  try {
    const notification = new Notification(title, { body, silent: true })
    notification.onclick = () => {
      onClick?.()
      try {
        window.focus()
      } catch {}
      notification.close()
    }
    return true
  } catch {
    return false
  }
}
