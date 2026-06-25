import { emitClientLocalEvent } from '#/web/local-events.ts'
import { resolveWebSocketProtocol } from '#/web/lib/websocket-url.ts'
import { ACCESS_TOKEN_QUERY } from '#/shared/access-token.ts'
import {
  normalizeTerminalSocketServerMessage,
  normalizeTerminalSlotSnapshot,
  normalizeTerminalSlotSummaryList,
} from '#/shared/terminal-validators.ts'
import { resolveTerminalController } from '#/shared/terminal-controller.ts'
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
  TerminalSlotSnapshot,
  TerminalSlotSnapshotInput,
  TerminalSlotSummary,
  TerminalTakeoverResult,
  TerminalTitleEvent,
  TerminalRestartInput,
} from '#/shared/terminal-types.ts'
import type { ClientTerminalBridge } from '#/web/client-bridge-types.ts'
import type { TerminalIdentityViewModel, TerminalLifecycleViewModel } from '#/web/components/terminal/types.ts'
import { isAppQuitting, subscribeAppQuitting } from '#/web/app-lifecycle.ts'

// Matches the server-side `HEARTBEAT_INTERVAL_MS`. Kept as a
// client-local constant so the client doesn't need to import a
// server module to know its own beat cadence.
const TERMINAL_CLIENT_HEARTBEAT_INTERVAL_MS = 30_000

export interface ClientServerTerminalConfig {
  url: string
  accessToken: string
  clientId: string
}

const WEB_TERMINAL_CLIENT_ID_STORAGE_KEY = 'goblin:web-terminal-client-id'
const TERMINAL_SOCKET_OPEN_TIMEOUT_MS = 10_000
const TERMINAL_REQUEST_TIMEOUT_MS = 30_000

export function createServerTerminalBridge(options: {
  getServerConfig: () => ClientServerTerminalConfig
  getClientId: () => string
  // `notifyBell` returning `undefined` (rather than a `Promise<false>`)
  // is the *deliberate* signal to fall through to the bridge's
  // built-in browser-notification path. The client-bridge wrapper
  // uses that distinction so the web-runtime bell events get the
  // full Notification API + click handler — collapsing both paths
  // to `Promise.resolve(false)` would make the bell click test
  // indistinguishable from "notification dismissed".
  notifyBell?: (input: TerminalNotifyBellInput) => Promise<TerminalMutationResult> | undefined
  sendTestNotification?: () => Promise<boolean> | undefined
  setBadge?: (count: number) => void
}): ClientTerminalBridge {
  type PendingSocketRequest = {
    action: TerminalSocketRequestAction
    resolve: (value: TerminalSocketResponseOutputs[TerminalSocketRequestAction]) => void
    reject: (reason?: unknown) => void
    timeout: ReturnType<typeof setTimeout>
  }
  const outputSubscribers = new Set<(event: TerminalOutputEvent) => void>()
  const titleSubscribers = new Set<(event: TerminalTitleEvent) => void>()
  const exitSubscribers = new Set<(event: TerminalExitEvent) => void>()
  const identitySubscribers = new Set<(event: TerminalIdentityViewModel) => void>()
  const lifecycleSubscribers = new Set<(event: TerminalLifecycleViewModel) => void>()
  const sessionsChangedSubscribers = new Set<(repoRoot: string) => void>()
  const slotClosedSubscribers = new Set<(event: { ptySessionId: string; repoRoot: string }) => void>()
  const clientId = options.getClientId()
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null
  // Client→server liveness heartbeat. Sent while the socket is
  // OPEN; the server's broker uses receipts to drive its per-`clientId`
  // deadline scan. Tied to the socket lifetime so it cannot outlive
  // the connection it's measuring.
  let heartbeatTimer: ReturnType<typeof globalThis.setInterval> | null = null
  let manualSocketClose = false
  let socketGeneration = 0
  let quitting = isAppQuitting()
  let pendingSocketOpenRequests = 0
  const pendingSocketRequests = new Map<string, PendingSocketRequest>()

  function hasRealtimeSubscribers(): boolean {
    return (
      outputSubscribers.size > 0 ||
      titleSubscribers.size > 0 ||
      exitSubscribers.size > 0 ||
      identitySubscribers.size > 0 ||
      lifecycleSubscribers.size > 0 ||
      sessionsChangedSubscribers.size > 0 ||
      slotClosedSubscribers.size > 0
    )
  }

  function shouldKeepSocketOpen(): boolean {
    return hasRealtimeSubscribers() || pendingSocketOpenRequests > 0 || pendingSocketRequests.size > 0
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

  // T5.1: explicit reconnect trigger for visibility recovery (mobile
  // background-tab resume, bfcache restore). The mobile OS may silently
  // drop the WebSocket while the tab is backgrounded; the existing
  // handleSocketDisconnection → scheduleReconnect path is correct
  // but the 300ms backoff adds latency the user feels on the first
  // visible-tab interaction. kickReconnect() short-circuits that
  // backoff: if the socket is null or fully CLOSED, we open
  // immediately. If it's OPEN, we do nothing — the socket is
  // healthy and a gratuitous cycle would just burn a handshake. If
  // it's CONNECTING or CLOSING, ensureSocket's internal guard makes
  // the call a no-op; the in-flight transition's close handler will
  // route through scheduleReconnect on its own if it fails.
  function kickReconnect() {
    if (quitting) return
    if (!hasRealtimeSubscribers()) return
    if (typeof WebSocket === 'undefined') return
    const currentSocket = socket
    if (!currentSocket || currentSocket.readyState === WebSocket.CLOSED) {
      // ensureSocket is a no-op if `socket` is already non-null and
      // OPEN, so this is safe in any state.
      ensureSocket()
    }
  }

  function ensureSocket() {
    if (socket || typeof WebSocket === 'undefined' || quitting) return
    let socketUrl: string
    try {
      const server = options.getServerConfig()
      socketUrl = createTerminalWebSocketUrl(server.url, server.accessToken, server.clientId)
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
        return
      }
      startHeartbeat(currentSocket, generation)
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
      } else if (message.type === 'slot-closed') {
        for (const subscriber of slotClosedSubscribers)
          subscriber({ ptySessionId: message.ptySessionId, repoRoot: message.repoRoot })
      } else if (message.type === 'identity') {
        const identityEvent = {
          ptySessionId: message.event.ptySessionId,
          ...resolveTerminalController(message.event.controller, clientId),
          canonicalCols: message.event.canonicalCols,
          canonicalRows: message.event.canonicalRows,
        }
        for (const subscriber of identitySubscribers) subscriber(identityEvent)
      } else if (message.type === 'lifecycle') {
        for (const subscriber of lifecycleSubscribers) subscriber(message.event)
      } else {
        // Unknown realtime message — ignore.
      }
    })
    currentSocket.addEventListener('close', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      stopHeartbeat()
      handleSocketDisconnection('Terminal socket closed')
    })
    currentSocket.addEventListener('error', () => {
      if (!isActiveSocket(currentSocket, generation)) return
      stopHeartbeat()
      handleSocketDisconnection('Terminal socket error')
    })
  }

  function startHeartbeat(currentSocket: WebSocket, generation: number): void {
    stopHeartbeat()
    // The 30 s cadence matches `HEARTBEAT_INTERVAL_MS` on the server
    // broker (`src/server/terminal/terminal-realtime-broker.ts`).
    // The 90 s deadline (3 missed beats) is what fires a synthetic
    // `onClientDisconnected`, which in turn lets the next `attach`
    // auto-claim the slot under the new user-sticky model.
    // Use `globalThis.setInterval` (not `window.setInterval`) so the
    // node-env test suite — which mocks `WebSocket` but does not
    // install `window` — does not crash on this line when the
    // mock socket fires its synthetic `open` event.
    heartbeatTimer = globalThis.setInterval(() => {
      if (!isActiveSocket(currentSocket, generation)) {
        stopHeartbeat()
        return
      }
      if (currentSocket.readyState !== WebSocket.OPEN) {
        // Defensive: the close handler should have stopped us, but
        // if a transition slipped through, don't send on a non-open
        // socket (the browser will throw).
        return
      }
      try {
        currentSocket.send(JSON.stringify({ type: 'heartbeat', at: Date.now() }))
      } catch {
        // Send failure is a signal that the socket is half-broken
        // — the `error` event *should* fire, but on some browser
        // implementations a `send` throw lands without a
        // corresponding `error` event, leaving the user silently
        // wedged until the OS closes the TCP. Kick the reconnect
        // path explicitly so the worst-case latency is the
        // existing reconnect backoff instead of a TCP timeout
        // (which can be hours on a healthy-looking half-open
        // connection).
        stopHeartbeat()
        handleSocketDisconnection('Terminal heartbeat send failed')
      }
    }, TERMINAL_CLIENT_HEARTBEAT_INTERVAL_MS)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer === null) return
    globalThis.clearInterval(heartbeatTimer)
    heartbeatTimer = null
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
        const sessions = normalizeTerminalSlotSummaryList(value)
        if (!sessions) throw new Error('Terminal socket response failed: invalid terminal sessions response')
        return sessions
      })
    },
    prewarm() {
      // T1.2: pay the WebSocket handshake cost when the user enters
      // a repo so the first real IPC after they click a terminal view
      // doesn't have to. waitForSocketOpen() resolves immediately if
      // the socket is already OPEN; otherwise it calls ensureSocket()
      // and waits for the 'open' event. Swallow failures — this is
      // a best-effort optimization, the next real call will surface
      // any actual problem.
      return waitForSocketOpen()
        .then(() => undefined)
        .catch(() => {})
    },
    getSlotSnapshot(input) {
      return requestOverSocket('slot-snapshot', input satisfies TerminalSlotSnapshotInput).then((value) => {
        if (value === null) return null
        const snapshot = normalizeTerminalSlotSnapshot(value)
        if (!snapshot) throw new Error('Terminal socket response failed: invalid terminal session snapshot response')
        return snapshot
      })
    },
    notifyBell(input) {
      // First check whether the wrapper has a native handler at all
      // (the client-bridge wrapper is always present, so this is
      // the "Electron preload registered" case). Then call it and
      // inspect the *result*: `undefined` means "no native bridge
      // right now, fall through to the browser notification path".
      if (options.notifyBell) {
        const native = options.notifyBell(input)
        if (native !== undefined) return native
      }
      return showBrowserNotification(input.title, input.body, () => {
        emitClientLocalEvent({ type: 'terminal-bell-click', repoRoot: input.repoRoot, key: input.key })
      })
    },
    sendTestNotification() {
      const native = options.sendTestNotification?.()
      if (native !== undefined) return native
      return showBrowserNotification('Goblin', 'Test notification')
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
    onIdentity(cb) {
      identitySubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        identitySubscribers.delete(cb)
        closeSocketIfIdle()
      }
    },
    onLifecycle(cb) {
      lifecycleSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        lifecycleSubscribers.delete(cb)
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
    onSlotClosed(cb) {
      slotClosedSubscribers.add(cb)
      manualSocketClose = false
      ensureSocket()
      return () => {
        slotClosedSubscribers.delete(cb)
        closeSocketIfIdle()
      }
    },
    kickReconnect() {
      kickReconnect()
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
  ): Promise<TerminalSlotSummary[]>
  async function requestOverSocket(
    action: 'slot-snapshot',
    input: TerminalSlotSnapshotInput,
  ): Promise<TerminalSlotSnapshot | null>
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
  async function requestOverSocket<TAction extends TerminalSocketRequestAction>(
    action: TAction,
    input: TerminalSocketRequestInputs[TAction],
  ): Promise<TerminalSocketResponseOutputs[TAction]> {
    pendingSocketOpenRequests += 1
    let ws: WebSocket
    try {
      ws = await waitForSocketOpen()
    } finally {
      pendingSocketOpenRequests = Math.max(0, pendingSocketOpenRequests - 1)
    }
    return await new Promise<TerminalSocketResponseOutputs[TAction]>((resolve, reject) => {
      const requestId = createSocketRequestId()
      const timeout = setTimeout(() => {
        const pending = pendingSocketRequests.get(requestId)
        if (!pending) return
        pendingSocketRequests.delete(requestId)
        clearTimeout(pending.timeout)
        closeSocketIfIdle()
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
    if (currentSocket.readyState === WebSocket.CLOSED || currentSocket.readyState === WebSocket.CLOSING) {
      return Promise.reject(new Error('Terminal socket closed before open'))
    }
    return new Promise<WebSocket>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        settle(() => {
          if (socket === currentSocket) {
            handleSocketDisconnection('Terminal socket open timed out')
            try {
              currentSocket.close()
            } catch {}
          }
          reject(new Error('Terminal socket open timed out'))
        })
      }, TERMINAL_SOCKET_OPEN_TIMEOUT_MS)
      const settle = (fn: () => void) => {
        cleanup()
        fn()
      }
      const handleOpen = () => {
        settle(() => {
          if (socket === currentSocket && currentSocket.readyState === WebSocket.OPEN) resolve(currentSocket)
          else reject(new Error('Terminal socket replaced before open'))
        })
      }
      const handleClose = () => settle(() => reject(new Error('Terminal socket closed before open')))
      const handleError = () => settle(() => reject(new Error('Terminal socket error before open')))
      const cleanup = () => {
        if (timeout !== null) {
          clearTimeout(timeout)
          timeout = null
        }
        currentSocket.removeEventListener?.('open', handleOpen)
        currentSocket.removeEventListener?.('close', handleClose)
        currentSocket.removeEventListener?.('error', handleError)
      }
      currentSocket.addEventListener('open', handleOpen)
      currentSocket.addEventListener('close', handleClose)
      currentSocket.addEventListener('error', handleError)
    })
  }
}

export function createTerminalWebSocketUrl(
  baseUrl: string,
  accessToken: string,
  clientId: string,
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

export function readOrCreateWebTerminalClientId(): string {
  const fallback = `client_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  try {
    const storage = window.sessionStorage
    const existing = storage?.getItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY)?.trim()
    if (existing) return existing
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `client_${crypto.randomUUID().replace(/-/g, '')}`
        : fallback
    storage?.setItem(WEB_TERMINAL_CLIENT_ID_STORAGE_KEY, created)
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
