// Tests for the client-side theme store. Specifically covers the
// `installMediaQueryListener` path that keeps the resolved theme in sync
// when the OS appearance flips while the user's pref is 'auto'. The
// store's invalidation-driven refresh path is covered by
// `web-invalidation-sync.test.ts`.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ClientBootstrapSnapshot } from '#/shared/bootstrap.ts'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { defaultSettingsSnapshot, defaultUserSettings } from '#/shared/settings-defaults.ts'
import { mockFetch } from '#/test-utils/fetch-mock.ts'

interface FakeMediaQueryList {
  matches: boolean
  addEventListener: (type: 'change', listener: () => void) => void
  removeEventListener: (type: 'change', listener: () => void) => void
  /** Fires every registered 'change' listener. Used by tests to simulate OS flips. */
  emitChange(): void
  /** Test-only: count of currently-registered listeners. */
  listenerCount(): number
}

function createMediaQuery(initialMatches = false): FakeMediaQueryList {
  const listeners = new Set<() => void>()
  const mql: FakeMediaQueryList = {
    matches: initialMatches,
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
    emitChange() {
      for (const listener of listeners) listener()
    },
    listenerCount() {
      return listeners.size
    },
  }
  return mql
}

interface FakeDocumentElement {
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
}

function createDocumentElement(initial: Record<string, string> = {}): FakeDocumentElement {
  const attrs = new Map<string, string>(Object.entries(initial))
  return {
    setAttribute(name, value) {
      attrs.set(name, value)
    },
    getAttribute(name) {
      return attrs.get(name) ?? null
    },
  }
}

interface InstallWindowOptions {
  documentElement?: FakeDocumentElement
  matchMedia?: FakeMediaQueryList | 'absent'
}

function installWindow(options: InstallWindowOptions = {}): void {
  const documentElement = options.documentElement ?? createDocumentElement()
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible', documentElement },
  })
  const windowValue: Record<string, unknown> = {
    __GOBLIN_BOOTSTRAP__: webBootstrap(),
    location: {
      href: 'http://127.0.0.1:32100/',
      origin: 'http://127.0.0.1:32100',
      protocol: 'http:',
      search: '',
    },
    setInterval,
    clearInterval,
  }
  if (options.matchMedia !== 'absent') {
    windowValue.matchMedia = vi.fn(() => options.matchMedia ?? null)
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowValue,
  })
}

function webBootstrap(overrides: Partial<ClientBootstrapSnapshot> = {}): ClientBootstrapSnapshot {
  return {
    runtime: { kind: 'web', bridgeVersion: CLIENT_BRIDGE_VERSION, capabilities: [] },
    initialServer: overrides.initialServer ?? null,
    ...overrides,
  }
}

function settingsResponse(overrides: Record<string, unknown> = {}) {
  return {
    ...defaultSettingsSnapshot(),
    ...overrides,
  }
}

describe('theme store OS-appearance sync', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  afterEach(async () => {
    // Drop the WebSocket ingress the test bootstrapped when
    // `subscribeSettingsInvalidationRefetch` wired itself up; the
    // singleton lives across `vi.resetModules()`'s module-cache
    // wipe only because of how `vi.resetModules` is implemented, so
    // explicit teardown matches the reference pattern in
    // `web-invalidation-sync.test.ts`.
    const { resetServerInvalidationIngressForTests } = await import('#/web/server-invalidation-ingress.ts')
    resetServerInvalidationIngressForTests()
    vi.unstubAllGlobals()
  })

  test('pref=auto + OS dark→light flips store and data-theme without a server round-trip', async () => {
    const mql = createMediaQuery(true) // OS starts dark
    installWindow({ matchMedia: mql })
    const fetchMock = mockFetch(async () => ({
      ok: true,
      json: async () => settingsResponse({ theme: 'auto', colorTheme: 'macos' }),
    }))
    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()

    // After hydrate with OS=dark, store/attr should be dark.
    expect(useThemeStore.getState().resolved).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    // OS flips dark→light.
    mql.matches = false
    mql.emitChange()

    expect(useThemeStore.getState().resolved).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    // No new fetch — the sync must be purely local.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('pref=light ignores OS flips — explicit pick pins the resolved theme', async () => {
    const mql = createMediaQuery(false) // OS starts light
    installWindow({ matchMedia: mql })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => settingsResponse({ theme: 'light', colorTheme: 'macos' }),
      })),
    )

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()

    expect(useThemeStore.getState().resolved).toBe('light')

    // OS flips to dark while user pinned light — store must NOT follow.
    mql.matches = true
    mql.emitChange()

    expect(useThemeStore.getState().pref).toBe('light')
    expect(useThemeStore.getState().resolved).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('pref=dark ignores OS flips — explicit pick pins the resolved theme', async () => {
    const mql = createMediaQuery(true) // OS starts dark
    installWindow({ matchMedia: mql })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => settingsResponse({ theme: 'dark', colorTheme: 'github' }),
      })),
    )

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()

    expect(useThemeStore.getState().resolved).toBe('dark')

    // OS flips to light while user pinned dark — store must NOT follow.
    mql.matches = false
    mql.emitChange()

    expect(useThemeStore.getState().pref).toBe('dark')
    expect(useThemeStore.getState().resolved).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-color-theme')).toBe('github')
  })

  test('re-hydrate disposes the prior media-query listener instead of double-registering', async () => {
    const mql = createMediaQuery(false)
    const addSpy = vi.spyOn(mql, 'addEventListener')
    const removeSpy = vi.spyOn(mql, 'removeEventListener')
    installWindow({ matchMedia: mql })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => settingsResponse({ theme: 'auto', colorTheme: 'macos' }),
      })),
    )

    const { useThemeStore } = await import('#/web/stores/theme.ts')

    await useThemeStore.getState().hydrate()
    expect(addSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(0)
    expect(mql.listenerCount()).toBe(1)

    await useThemeStore.getState().hydrate()
    // Second hydrate disposes the first listener and installs a fresh one.
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(addSpy).toHaveBeenCalledTimes(2)
    expect(mql.listenerCount()).toBe(1)

    // A registered change listener still reacts to the OS flip exactly once.
    let calls = 0
    const capture = () => {
      calls++
    }
    mql.addEventListener('change', capture)
    mql.matches = true
    mql.emitChange()
    expect(calls).toBe(1)
  })

  test('matchMedia unavailable: hydrate still completes and listener is a no-op', async () => {
    // Use `theme: 'light'` so `resolveThemeStateFromUserSettings` in
    // `settings-client.ts` never dereferences `matchMedia` (the
    // optional chain there yields `undefined` when matchMedia is
    // absent, and `.matches` would throw).
    installWindow({ matchMedia: 'absent' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => settingsResponse({ theme: 'light', colorTheme: 'macos' }),
      })),
    )

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()

    expect(useThemeStore.getState()).toMatchObject({ pref: 'light', resolved: 'light', colorTheme: 'macos' })
    // No throw, store remains valid.
  })

  test('pref=auto + auto→light→auto re-pins the resolved theme from matchMedia at each step', async () => {
    const mql = createMediaQuery(true) // OS is dark
    installWindow({ matchMedia: mql })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => settingsResponse({ theme: 'auto', colorTheme: 'macos' }),
      })),
    )

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()
    expect(useThemeStore.getState().resolved).toBe('dark')

    // Simulate the user picking 'light' by mutating the store
    // directly — `setPref`'s server round-trip is covered by
    // `web-invalidation-sync.test.ts`, and the listener contract
    // here is what we actually want to lock in.
    useThemeStore.setState({ pref: 'light', resolved: 'light' })
    document.documentElement.setAttribute('data-theme', 'light')

    // OS stays dark — listener must be inert while pref is explicit.
    mql.emitChange()
    expect(useThemeStore.getState().resolved).toBe('light')

    // User switches back to auto. Re-derive resolved from matchMedia
    // at this moment (matchMedia.matches is true → dark) and apply.
    useThemeStore.setState({ pref: 'auto', resolved: mql.matches ? 'dark' : 'light' })
    document.documentElement.setAttribute('data-theme', mql.matches ? 'dark' : 'light')

    // Subsequent OS flip still drives the store.
    mql.matches = false
    mql.emitChange()
    expect(useThemeStore.getState().resolved).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('hydrate applies the server snapshot verbatim on first paint', async () => {
    // Server stores `theme` + `colorTheme`; the client derives
    // `resolved` from `theme` + matchMedia. The pref survives a
    // round-trip, even when the pref is explicit.
    const mql = createMediaQuery(true) // OS is dark
    installWindow({ matchMedia: mql })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => settingsResponse({ theme: 'light', colorTheme: 'github' }),
      })),
    )

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().hydrate()

    expect(useThemeStore.getState()).toMatchObject({
      pref: 'light',
      resolved: 'light',
      colorTheme: 'github',
    })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-color-theme')).toBe('github')
  })

  test('setPref syncs the settings snapshot query cache from the server response', async () => {
    installWindow({ matchMedia: createMediaQuery(false) })
    const { primaryWindowQueryClient } = await import('#/web/primary-window-queries.ts')
    const { settingsSnapshotQueryKey } = await import('#/web/settings-query-cache.ts')
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ theme: 'auto', colorTheme: 'macos' }),
    )
    mockFetch(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        prefs: defaultUserSettings({ theme: 'dark', colorTheme: 'github' }),
      }),
    }))

    const { useThemeStore } = await import('#/web/stores/theme.ts')
    await useThemeStore.getState().setPref('dark')

    expect(primaryWindowQueryClient.getQueryData(settingsSnapshotQueryKey())).toMatchObject({
      theme: 'dark',
      colorTheme: 'github',
    })
    expect(useThemeStore.getState()).toMatchObject({
      pref: 'dark',
      colorTheme: 'github',
    })
  })
})
