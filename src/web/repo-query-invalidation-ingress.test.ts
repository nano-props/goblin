import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

  public readonly url: string
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const next = this.listeners.get(type) ?? new Set()
    next.add(listener)
    this.listeners.set(type, next)
  }

  close(): void {
    this.emit('close', {})
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) })
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function installWindow(value: Record<string, unknown>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value,
  })
}

describe('repo query invalidation source', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  })

  afterEach(async () => {
    const { resetServerInvalidationIngressForTests } = await import('#/web/server-invalidation-ingress.ts')
    resetServerInvalidationIngressForTests()
    vi.useRealTimers()
  })

  test('uses server invalidation stream when Electron shell and embedded server are both present', async () => {
    installWindow({
      __GOBLIN_BOOTSTRAP__: {
        runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
        homeDir: '',
        platform: 'darwin',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
      },
      goblinNative: {
        runtime: {
          kind: 'electron',
          bridgeVersion: RENDERER_BRIDGE_VERSION,
          capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
        },
        homeDir: '',
        platform: 'darwin',
        initialI18n: null,
        initialSettings: null,
        invokeIpc: vi.fn(),
        abortIpc: vi.fn(),
        onEvent: vi.fn(() => () => {}),
        pathForFile: vi.fn(() => ''),
        terminal: {
          open: vi.fn(),
          restart: vi.fn(),
          write: vi.fn(),
          resize: vi.fn(),
          takeover: vi.fn(),
          close: vi.fn(),
          create: vi.fn(),
          pruneTerminals: vi.fn(),
          notifyBell: vi.fn(),
          sendTestNotification: vi.fn(),
          setBadge: vi.fn(),
          onOutput: vi.fn(() => () => {}),
          onTitle: vi.fn(() => () => {}),
          onExit: vi.fn(() => () => {}),
        },
      },
    })

    const listener = vi.fn()
    const { subscribeRepoQueryInvalidation } = await import('#/web/repo-query-invalidation-ingress.ts')
    const dispose = subscribeRepoQueryInvalidation(listener)

    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0]?.emitMessage({
      type: 'repo-query-invalidated',
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })

    expect(listener).toHaveBeenCalledWith({
      type: 'repo-query-invalidated',
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    dispose()
  })

  test('uses server invalidation stream in pure web mode', async () => {
    installWindow({
      __GOBLIN_BOOTSTRAP__: {
        runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
        homeDir: '',
        platform: 'darwin',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    })

    const listener = vi.fn()
    const { subscribeRepoQueryInvalidation } = await import('#/web/repo-query-invalidation-ingress.ts')
    const dispose = subscribeRepoQueryInvalidation(listener)

    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0]?.emitMessage({
      type: 'repo-query-invalidated',
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })

    expect(listener).toHaveBeenCalledWith({
      type: 'repo-query-invalidated',
      repoId: '/tmp/repo',
      query: 'repo-snapshot',
    })
    dispose()
  })

  test('reconnects invalidation socket with a short delay after unexpected close', async () => {
    installWindow({
      __GOBLIN_BOOTSTRAP__: {
        runtime: { kind: 'web', bridgeVersion: RENDERER_BRIDGE_VERSION, capabilities: [] },
        homeDir: '',
        platform: 'darwin',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    })

    const listener = vi.fn()
    const { subscribeRepoQueryInvalidation } = await import('#/web/repo-query-invalidation-ingress.ts')
    const dispose = subscribeRepoQueryInvalidation(listener)

    expect(FakeWebSocket.instances).toHaveLength(1)
    FakeWebSocket.instances[0]?.close()
    expect(FakeWebSocket.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(299)
    expect(FakeWebSocket.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(FakeWebSocket.instances).toHaveLength(2)

    dispose()
  })
})
