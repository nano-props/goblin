// In-house `WebSocket` and `Notification` mocks for jsdom. Upstream
// testing libraries do not ship lightweight mocks for either; the
// alternatives (msw WebSocket, undici MockAgent) are heavier and do not
// fit the per-test reset cycle.
//
// Two `MockWebSocket` flavors are supported via `installWebSocketMock`:
//
//   - `autoOpen: true` (default) — the socket transitions to `OPEN`
//     and emits the `open` event on the next microtask. Mirrors the
//     behavior tests for the repo store expect from a benign real
//     socket.
//   - `autoOpen: false` — the socket stays in `CONNECTING` until the
//     test calls `emitOpen()` itself. `terminal.test.ts` uses this
//     flavor to exercise the timeout / early-close paths.

export interface MockWebSocketInstance {
  readonly url: string
  readyState: number
  sent: string[]
  addEventListener: (type: string, cb: (event: unknown) => void) => void
  removeEventListener: (type: string, cb: (event: unknown) => void) => void
  send: (data: string) => void
  close: () => void
  emitOpen: () => void
  emitMessage: (data: unknown) => void
  emitError: () => void
  emit: (type: string, event: unknown) => void
}

export interface WebSocketMockHandle {
  instances: MockWebSocketInstance[]
  MockWebSocket: new (url: string) => MockWebSocketInstance
  MockNotification: new (title: string, options?: NotificationOptions) => MockNotificationInstance
  notificationInstances: MockNotificationInstance[]
  CONNECTING: number
  OPEN: number
  CLOSING: number
  CLOSED: number
  reset: () => void
}

export interface MockNotificationInstance {
  readonly title: string
  readonly options?: NotificationOptions
  onclick: (() => void) | null
  close: () => void
}

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

export function installWebSocketMock(options: { autoOpen?: boolean } = {}): WebSocketMockHandle {
  const autoOpen = options.autoOpen ?? true
  const instances: MockWebSocketInstance[] = []
  const notificationInstances: MockNotificationInstance[] = []

  class MockWebSocket implements MockWebSocketInstance {
    static readonly CONNECTING = CONNECTING
    static readonly OPEN = OPEN
    static readonly CLOSING = CLOSING
    static readonly CLOSED = CLOSED
    readonly url: string
    readyState = CONNECTING
    sent: string[] = []
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>()

    constructor(url: string) {
      this.url = url
      instances.push(this)
      if (autoOpen) {
        queueMicrotask(() => {
          if (this.readyState !== CONNECTING) return
          this.readyState = OPEN
          this.emit('open', {})
        })
      }
    }

    addEventListener(type: string, cb: (event: unknown) => void) {
      let set = this.listeners.get(type)
      if (!set) {
        set = new Set()
        this.listeners.set(type, set)
      }
      set.add(cb)
    }

    removeEventListener(type: string, cb: (event: unknown) => void) {
      this.listeners.get(type)?.delete(cb)
    }

    send(data: string) {
      this.sent.push(data)
    }

    close() {
      this.readyState = CLOSED
      this.emit('close', {})
    }

    emitOpen() {
      this.readyState = OPEN
      this.emit('open', {})
    }

    emitMessage(data: unknown) {
      this.emit('message', { data })
    }

    emitError() {
      this.emit('error', {})
    }

    emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }

  class MockNotification implements MockNotificationInstance {
    static permission: NotificationPermission = 'granted'
    static async requestPermission(): Promise<NotificationPermission> {
      return 'granted'
    }
    readonly title: string
    readonly options?: NotificationOptions
    onclick: (() => void) | null = null
    constructor(title: string, options?: NotificationOptions) {
      this.title = title
      this.options = options
      notificationInstances.push(this)
    }
    close() {}
  }

  const handle: WebSocketMockHandle = {
    instances,
    MockWebSocket,
    MockNotification,
    notificationInstances,
    CONNECTING,
    OPEN,
    CLOSING,
    CLOSED,
    reset() {
      instances.length = 0
      notificationInstances.length = 0
    },
  }

  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: MockWebSocket,
  })
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: MockNotification,
  })

  return handle
}

export function resetWebSocketMock(handle: WebSocketMockHandle): void {
  handle.reset()
}
