import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'
import { flushMicrotasks } from '#/test-utils/microtasks.ts'
import {
  installWebSocketMock,
  type MockWebSocketInstance,
  type WebSocketMockHandle,
} from '#/web/test-utils/websocket-mock.ts'

let wsMock: WebSocketMockHandle

function installWebBootstrap(bootstrap: ClientBootstrapSnapshot): void {
  const documentElement = {
    attrs: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attrs.set(name, value)
    },
    getAttribute(name: string) {
      return this.attrs.get(name) ?? null
    },
  }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      documentElement,
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: bootstrap,
      location: {
        href: bootstrap.initialServer?.url ?? 'http://127.0.0.1:32100/',
        origin: bootstrap.initialServer?.url?.replace(/\/$/, '') ?? 'http://127.0.0.1:32100',
        protocol: 'http:',
        search: '',
      },
      matchMedia: vi.fn(() => ({ matches: false })),
      setInterval,
      clearInterval,
    },
  })
  wsMock = installWebSocketMock({ autoOpen: false })
}

function webBootstrap(overrides: Partial<ClientBootstrapSnapshot> = {}): ClientBootstrapSnapshot {
  return {
    runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
    initialServer: null,
    ...overrides,
  }
}

function latestSocket(): MockWebSocketInstance {
  const socket = wsMock.instances.at(-1)
  if (!socket) throw new Error('Expected websocket to be created')
  return socket
}

function emitServerMessage(message: unknown): void {
  latestSocket().emitMessage(JSON.stringify(message))
}

function settingsSnapshotResponse(overrides: Record<string, unknown> & { colorTheme?: string } = {}) {
  return {
    ...defaultSettingsSnapshot(),
    ...overrides,
  }
}

describe('web invalidation sync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    const { resetServerInvalidationIngressForTests } = await import('#/web/server-invalidation-ingress.ts')
    resetServerInvalidationIngressForTests()
  })

  test('theme store refetches theme state on theme invalidation', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let settingsReadCount = 0
    mockFetch(async () => ({
      ok: true,
      json: async () => {
        settingsReadCount++
        return settingsSnapshotResponse({
          theme: settingsReadCount > 1 ? 'dark' : 'auto',
          colorTheme: settingsReadCount > 1 ? 'github' : 'macos',
        })
      },
    }))

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()
    emitServerMessage({ type: 'settings-invalidated', scopes: ['theme'] })
    await vi.waitFor(() => {
      expect(useThemeStore.getState()).toMatchObject({ pref: 'dark', resolved: 'dark', colorTheme: 'github' })
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      expect(document.documentElement.getAttribute('data-color-theme')).toBe('github')
    })
  })

  test('settings invalidation uses same-origin websocket when bootstrap has no server handoff', async () => {
    installWebBootstrap(webBootstrap({ initialServer: null }))
    let settingsReadCount = 0
    mockFetch(async () => ({
      ok: true,
      json: async () => {
        settingsReadCount++
        return settingsSnapshotResponse({
          theme: settingsReadCount > 1 ? 'dark' : 'auto',
          colorTheme: settingsReadCount > 1 ? 'github' : 'macos',
        })
      },
    }))

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()

    expect(latestSocket().url).toBe('ws://127.0.0.1:32100/ws/invalidation')
    emitServerMessage({ type: 'settings-invalidated', scopes: ['theme'] })

    await vi.waitFor(() => {
      expect(useThemeStore.getState()).toMatchObject({ pref: 'dark', resolved: 'dark', colorTheme: 'github' })
    })
  })

  test('settings snapshot invalidation no longer refetches theme state', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let settingsReadCount = 0
    mockFetch(async () => ({
      ok: true,
      json: async () => {
        settingsReadCount++
        return settingsSnapshotResponse({
          theme: settingsReadCount > 1 ? 'dark' : 'auto',
          colorTheme: settingsReadCount > 1 ? 'github' : 'macos',
        })
      },
    }))

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()
    const beforeInvalidationReadCount = settingsReadCount

    emitServerMessage({ type: 'settings-invalidated', scopes: ['settings-snapshot'] })
    await flushMicrotasks()

    expect(settingsReadCount).toBe(beforeInvalidationReadCount)
    expect(useThemeStore.getState()).toMatchObject({ pref: 'auto', resolved: 'light', colorTheme: 'macos' })
  })

  test('unknown settings invalidation scopes are ignored', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => settingsSnapshotResponse(),
    }))
    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()
    const beforeInvalidationFetchCount = fetchMock.mock.calls.length

    emitServerMessage({ type: 'settings-invalidated', scopes: ['session'] })
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledTimes(beforeInvalidationFetchCount)
    expect(useThemeStore.getState()).toMatchObject({ pref: 'auto', resolved: 'light', colorTheme: 'macos' })
  })

  test('i18n store refetches payload only on i18n invalidation', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))
    let i18nReadCount = 0
    mockFetch(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.endsWith('/api/i18n')) {
          i18nReadCount++
          return i18nReadCount > 1
            ? { lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } }
            : { lang: 'en', pref: 'auto', dict: { hello: 'hello' } }
        }
        throw new Error(`Unexpected fetch: ${url}`)
      },
    }))

    const { useI18nStore } = await import('#/web/stores/i18n.ts')
    await useI18nStore.getState().hydrate()
    emitServerMessage({ type: 'settings-invalidated', scopes: ['i18n'] })
    await vi.waitFor(() => {
      expect(useI18nStore.getState()).toMatchObject({ lang: 'ja', pref: 'ja', dict: { hello: 'こんにちは' } })
      expect(document.documentElement.getAttribute('lang')).toBe('ja')
    })
  })

  test('settings refetch subscription coalesces repeated invalidations while a fetch is in flight', async () => {
    installWebBootstrap(webBootstrap({ initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' } }))

    const resolvers: Array<(value: number) => void> = []
    const apply = vi.fn()
    const fetch = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    const { subscribeSettingsInvalidationRefetch } = await import('#/web/settings-invalidation-refetch.ts')
    const dispose = subscribeSettingsInvalidationRefetch({
      scope: 'settings-snapshot',
      fetch,
      apply,
      label: 'test-sync',
    })

    emitServerMessage({ type: 'settings-invalidated', scopes: ['settings-snapshot'] })
    emitServerMessage({ type: 'settings-invalidated', scopes: ['settings-snapshot'] })
    emitServerMessage({ type: 'settings-invalidated', scopes: ['settings-snapshot'] })
    await flushMicrotasks()

    expect(fetch).toHaveBeenCalledTimes(1)

    const resolveFirstFetch = resolvers.shift()
    if (!resolveFirstFetch) throw new Error('Expected first fetch resolver')
    resolveFirstFetch(1)
    await vi.waitFor(() => {
      expect(apply).toHaveBeenCalledWith(1)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    const resolveSecondFetch = resolvers.shift()
    if (!resolveSecondFetch) throw new Error('Expected second fetch resolver')
    resolveSecondFetch(2)
    await vi.waitFor(() => {
      expect(apply).toHaveBeenNthCalledWith(2, 2)
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    dispose()
  })
})
