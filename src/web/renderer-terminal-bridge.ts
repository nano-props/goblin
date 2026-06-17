import { emitRendererLocalEvent } from '#/web/local-events.ts'
import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import {
  normalizeTerminalSocketServerMessage,
  normalizeTerminalSessionSnapshot,
  normalizeTerminalSessionSummaryList,
} from '#/shared/terminal-validators.ts'
import { resolveTerminalOwnership } from '#/shared/terminal-ownership.ts'
import type {
  TerminalClientMessage,
  TerminalSocketRequestAction,
  TerminalSocketRequestInputs,
  TerminalSocketResponseOutputs,
  TerminalSocketServerMessage,
} from '#/shared/terminal-socket.ts'
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalMutationResult,
  TerminalNotifyBellInput,
  TerminalOutputEvent,
  TerminalReorderInput,
  TerminalSessionSnapshot,
  TerminalSessionSnapshotInput,
  TerminalSessionSummary,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalRestartInput,
} from '#/shared/terminal-types.ts'
import type { RendererTerminalBridge } from '#/web/renderer-bridge-types.ts'
import type { TerminalOwnershipViewModel } from '#/web/components/terminal/types.ts'
import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'

export interface RendererServerTerminalConfig {
  url: string
  accessToken: string
  clientId: string
}

const WEB_TERMINAL_ATTACHMENT_ID_STORAGE_KEY = 'goblin:web-terminal-attachment-id'
const TERMINAL_REQUEST_TIMEOUT_MS = 30_000

export function createServerTerminalBridge(options: {
  getServerConfig: () => RendererServerTerminalConfig
  getAttachmentId: () => string
  notifyBell?: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult>
  sendTestNotification?: () => Promise<boolean>
  setBadge?: (count: number) => void
}): RendererTerminalBridge {
  type PendingSocketRequest = {
    action: TerminalSocketRequestAction
    resolve: (value: TerminalSocketResponseOutputs[TerminalSocketRequestAction]) => void
    reject: (reason?: unknown) => void
    timeout: ReturnType<typeof setTimeout>
  }
  const outputSubscribers = new Set<(event: TerminalOutputEvent) => void>()
  const titleSubscribers = new Set<(event: TerminalTitleEvent) => void>()
  const exitSubscribers = new Set<(event: TerminalExitEvent) => void>()
  const ownershipSubscribers = new Set<(event: TerminalOwnershipViewModel) => void>()
  const sessionsChangedSubscribers = new Set<(repoRoot: string) => void>()
  const attachmentId = options.getAttachmentId()
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null
  let manualSocketClose = false
  let socketGeneration = 0
  let quitting = isAppQuitting()
  const pendingSocketRequests = new Map<string, PendingSocketRequest>()

  function hasRealtimeSubscribers(): boolean {
    return (
      outputSubscribers.size > 0 ||
      titleSubscribers.size > 0 ||
      exitSubscribers.size > 0 ||
      ownershipSubscribers.size > 0 ||
      sessionsChangedSubscribers.size > 0
    )
  }

  function shouldKeepSocketOpen(): boolean {
    return hasRealtimeSubscribers() || pendingSocketRequests.size > 0
  }

  function isActiveSocket(currentSocket: WebSocket, generation: number): boolean {
    return socket === currentSocket && socketGeneration === generation
  }

  function clearReconnectTimer() {
    if (reconnectTimer === null) return
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function rejectPendingSocketRequests(message: string) {
    const error = new Error(message)
    for (const pending of pendingSocketRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    pendingSocketRequests.clear()
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null || !hasRealtimeSubscribers() || quitting) {
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
      socketUrl = createTerminalWebSocketUrl(server.url, server.accessToken, server.clientId, attachmentId)
    } catch {
      return
    }
    manualSocketClose = false
    const generation = (socketGeneration += 1)
    const currentSocket = new WebSocket(socketUrl)
    socket = currentSocket
    currentSocket.addEventListener('open', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      if (manualSocketClose && !shouldKeepSocketOpen()) {
        try {
          currentSocket.close()
        } catch {}
      }
    })
    currentSocket.addEventListener('message', (event) => {
      if (!isActiveSocket(currentSocket, generation)) return
      const message = parseTerminalSocketServerMessage(event.data)
      if (!message) return
      if (message.type === 'response') {
        settleSocketRequest(message)
        return
      }
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
      handleSocketDisconnection('Terminal socket closed')
    })
    currentSocket.addEventListener('error', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      handleSocketDisconnection('Terminal socket error')
    })
  }

  function handleSocketDisconnection(reason: string) {
    const wasManual = manualSocketClose
    rejectPendingSocketRequests(reason)
    socket = null
    manualSocketClose = false
    if (wasManual) {
      if (hasRealtimeSubscribers()) ensureSocket()
      return
    }
    scheduleReconnect()
  }

  function closeSocketIfIdle() {
    if (shouldKeepSocketOpen() || !socket) return
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
    rejectPendingSocketRequests('Terminal socket closed')
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
      return requestOverSocket('attach', input)
    },
    restart(input) {
      ensureSocket()
      return requestOverSocket('restart', input)
    },
    write(input) {
      return requestOverSocket('write', input).then((result) => result)
    },
    resize(input) {
      return requestOverSocket('resize', input).then((result) => result)
    },
    takeover(input) {
      return requestOverSocket('takeover', input)
    },
    close(input) {
      return requestOverSocket('close', input)
    },
    create(input) {
      return requestOverSocket('create', input satisfies TerminalCreateInput)
    },
    pruneTerminals(repoRoot) {
      return requestOverSocket('prune', { repoRoot })
    },
    listSessions(input) {
      return requestOverSocket('list-sessions', input).then((value) => {
        const sessions = normalizeTerminalSessionSummaryList(value)
        if (!sessions) throw new Error('Terminal socket response failed: invalid terminal sessions response')
        return sessions
      })
    },
    getSessionSnapshot(input) {
      return requestOverSocket('session-snapshot', input satisfies TerminalSessionSnapshotInput).then((value) => {
        if (value === null) return null
        const snapshot = normalizeTerminalSessionSnapshot(value)
        if (!snapshot) throw new Error('Terminal socket response failed: invalid terminal session snapshot response')
        return snapshot
      })
    },
    reorder(input) {
      return requestOverSocket('reorder', input satisfies TerminalReorderInput)
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
        closeSocketIfIdle()
      }
    },
    onTitle(cb) {
      titleSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        titleSubscribers.delete(cb)
        closeSocketIfIdle()
      }
    },
    onExit(cb) {
      exitSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        exitSubscribers.delete(cb)
        closeSocketIfIdle()
      }
    },
    onOwnership(cb) {
      ownershipSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        ownershipSubscribers.delete(cb)
        closeSocketIfIdle()
      }
    },
    onSessionsChanged(cb) {
      sessionsChangedSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        sessionsChangedSubscribers.delete(cb)
        closeSocketIfIdle()
      }
    },
  }

  function settleSocketRequest(message: Extract<TerminalSocketServerMessage, { type: 'response' }>) {
    const pending = pendingSocketRequests.get(message.requestId)
    if (!pending || pending.action !== message.action) return
    pendingSocketRequests.delete(message.requestId)
    clearTimeout(pending.timeout)
    if (message.ok) pending.resolve(message.payload)
    else pending.reject(new Error(message.error))
    closeSocketIfIdle()
  }

  async function requestOverSocket(action: 'attach', input: TerminalAttachInput): Promise<TerminalAttachResult>
  async function requestOverSocket(action: 'restart', input: TerminalRestartInput): Promise<TerminalAttachResult>
  async function requestOverSocket(action: 'create', input: TerminalCreateInput): Promise<TerminalCatalogMutationResult>
  async function requestOverSocket(
    action: 'prune',
    input: { repoRoot: string },
  ): Promise<{ pruned: number; remaining: number }>
  async function requestOverSocket(
    action: 'list-sessions',
    input: { repoRoot: string },
  ): Promise<TerminalSessionSummary[]>
  async function requestOverSocket(
    action: 'session-snapshot',
    input: TerminalSessionSnapshotInput,
  ): Promise<TerminalSessionSnapshot | null>
  async function requestOverSocket(
    action: 'write',
    input: TerminalSocketRequestInputs['write'],
  ): Promise<TerminalMutationResult>
  async function requestOverSocket(
    action: 'resize',
    input: TerminalSocketRequestInputs['resize'],
  ): Promise<TerminalMutationResult>
  async function requestOverSocket(
    action: 'takeover',
    input: TerminalSocketRequestInputs['takeover'],
  ): Promise<TerminalTakeoverResult>
  async function requestOverSocket(
    action: 'close',
    input: TerminalSocketRequestInputs['close'],
  ): Promise<TerminalMutationResult>
  async function requestOverSocket(
    action: 'reorder',
    input: TerminalSocketRequestInputs['reorder'],
  ): Promise<TerminalMutationResult>
  async function requestOverSocket<TAction extends TerminalSocketRequestAction>(
    action: TAction,
    input: TerminalSocketRequestInputs[TAction],
  ): Promise<TerminalSocketResponseOutputs[TAction]> {
    const ws = await waitForSocketOpen()
    return await new Promise<TerminalSocketResponseOutputs[TAction]>((resolve, reject) => {
      const requestId = createSocketRequestId()
      const timeout = setTimeout(() => {
        const pending = pendingSocketRequests.get(requestId)
        if (!pending) return
        pendingSocketRequests.delete(requestId)
        clearTimeout(pending.timeout)
        reject(new Error('Terminal request timed out'))
      }, TERMINAL_REQUEST_TIMEOUT_MS)
      pendingSocketRequests.set(requestId, {
        action,
        resolve: (value) => resolve(value as TerminalSocketResponseOutputs[TAction]),
        reject,
        timeout,
      })
      try {
        ws.send(
          encodeClientMessage({ type: 'request', requestId, action, input } as Extract<
            TerminalClientMessage,
            { action: TAction }
          >),
        )
      } catch (error) {
        clearTimeout(timeout)
        pendingSocketRequests.delete(requestId)
        closeSocketIfIdle()
        reject(error)
      }
    })
  }

  function waitForSocketOpen(): Promise<WebSocket> {
    if (typeof WebSocket === 'undefined') return Promise.reject(new Error('Terminal socket unavailable'))
    ensureSocket()
    const currentSocket = socket
    if (!currentSocket) return Promise.reject(new Error('Terminal socket unavailable'))
    if (currentSocket.readyState === WebSocket.OPEN) return Promise.resolve(currentSocket)
    return new Promise<WebSocket>((resolve, reject) => {
      const handleOpen = () => {
        cleanup()
        if (socket === currentSocket && currentSocket.readyState === WebSocket.OPEN) resolve(currentSocket)
        else reject(new Error('Terminal socket replaced before open'))
      }
      const handleClose = () => {
        cleanup()
        reject(new Error('Terminal socket closed before open'))
      }
      const cleanup = () => {
        currentSocket.removeEventListener?.('open', handleOpen)
        currentSocket.removeEventListener?.('close', handleClose)
      }
      currentSocket.addEventListener('open', handleOpen)
      currentSocket.addEventListener('close', handleClose)
    })
  }
}

export function createTerminalWebSocketUrl(
  baseUrl: string,
  accessToken: string,
  clientId: string,
  attachmentId: string,
): string {
  const httpUrl = new URL('/ws/terminal', baseUrl)
  httpUrl.protocol = resolveWebSocketProtocol()
  // `?t=` is the WebSocket auth channel for the access token. The
  // browser path also sends the cookie (auto-attached on the WS
  // upgrade), but `?t=` works for both browser and Electron — and
  // it's the only way to authenticate a non-browser WS client (LAN
  // CLI). The server middleware accepts all three channels
  // (cookie / header / `?t=`).
  httpUrl.searchParams.set(ACCESS_TOKEN_QUERY, accessToken)
  httpUrl.searchParams.set('clientId', clientId)
  httpUrl.searchParams.set('attachmentId', attachmentId)
  return httpUrl.toString()
}

export function parseTerminalSocketServerMessage(data: unknown): TerminalSocketServerMessage | null {
  if (typeof data !== 'string') return null
  try {
    return normalizeTerminalSocketServerMessage(JSON.parse(data))
  } catch {}
  return null
}

function encodeClientMessage(message: TerminalClientMessage): string {
  return JSON.stringify(message)
}

function createSocketRequestId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `request_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
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
