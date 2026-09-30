// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { QueryClient } from '@tanstack/vue-query'
import { fireEvent } from '@testing-library/vue'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WebSettings } from '#/web/components/settings/pages/WebSettings.tsx'
import { setClientBridgeForTests } from '#/web/bridge/client.ts'
import { lanInfoQueryKey, settingsSnapshotQueryKey } from '#/web/settings/query-cache.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { LanInfo } from '#/shared/api-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
const fetchServerJsonMock = vi.hoisted(() => vi.fn())
const accessTokenReadMock = vi.fn()
const testWindow = window as unknown as {
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  setClientBridgeForTests(null)
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
  fetchServerJsonMock.mockReset()
  accessTokenReadMock.mockReset()
  accessTokenReadMock.mockResolvedValue({ accessToken: 'active-secret' })
  fetchServerJsonMock.mockImplementation((path: string) =>
    path === '/api/access-token' ? accessTokenReadMock() : Promise.reject(new Error(`unmocked request: ${path}`)),
  )
})

afterEach(() => {
  document.body.innerHTML = ''
  Reflect.deleteProperty(navigator, 'clipboard')
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

async function renderPage(options: { lanInfo?: LanInfo } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({}))
  if (options.lanInfo) queryClient.setQueryData(lanInfoQueryKey(), options.lanInfo)
  return renderInJsdom(
    <VueQueryClientScope client={queryClient}>
      <WebSettings />
    </VueQueryClientScope>,
  )
}

function seedWebBootstrap() {
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'web',
      bridgeVersion: 1,
      capabilities: [],
    },
    initialServer: null,
  }
  setClientBridgeForTests({
    getBootstrap: () => testWindow.__GOBLIN_BOOTSTRAP__ as never,

    saveClipboardFiles: vi.fn(async () => []),

    appRealtime: () => ({
      kickReconnect: () => {},
      onRecovered: () => () => {},
    }),
    terminal: () => ({
      attach: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      restart: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      write: vi.fn(async () => ({ status: 'rejected' as const })),
      resize: vi.fn(async () => ({ ok: false as const, message: 'not configured' })),
      takeover: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      close: vi.fn(async () => false),
      recoverSessions: vi.fn(async () => ({ revision: 0, sessions: [] })),
      notifyBell: vi.fn(async () => false),
      sendTestNotification: vi.fn(async () => false),

      onOutput: () => () => {},
      onBell: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onIdentity: () => () => {},
      onLifecycle: () => () => {},
      onSessionsChanged: () => () => {},
      onSessionClosed: () => () => {},
    }),
    workspacePaneTabs: () => ({
      replace: vi.fn(async () => ({ kind: 'projected' as const, snapshot: { revision: 0, entries: [] } })),
      update: vi.fn(async () => ({ kind: 'projected' as const, snapshot: { revision: 0, entries: [] } })),
      list: vi.fn(async () => ({ revision: 0, entries: [] })),
      onChanged: () => () => {},
    }),
    workspacePaneRuntime: () => ({
      open: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
      close: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
    }),
  })
}

describe('WebSettings', () => {
  test('hides the Rotate token button and LAN section in the web runtime', async () => {
    // Server lifecycle settings are controlled by startup arguments.
    seedWebBootstrap()
    const { container } = await renderPage()

    const html = container.innerHTML
    expect(html).not.toContain('settings.web.token-rotate')
    expect(html).not.toContain('settings.lan.enabled')
  })

  test('shows the current browser origin and token copy button after reopening settings', async () => {
    // The current address is a property of the loaded page, not the optional
    // QR/login bootstrap handoff. Normal sessions must never regress to an
    // empty dash when `initialServer` is null.
    seedWebBootstrap()
    const { container: firstContainer, unmount: unmountFirst } = await renderPage()
    const firstHtml = firstContainer.innerHTML
    expect(firstHtml).toContain('settings.web.url')
    expect(firstHtml).toContain('settings.web.token-copy')
    expect(firstContainer.querySelector('#settings-web-url')?.textContent).toBe(window.location.origin)

    await flushTestUpdates(() => {
      unmountFirst()
    })

    seedWebBootstrap()
    const { container: webContainer } = await renderPage()
    const webHtml = webContainer.innerHTML
    expect(webHtml).toContain('settings.web.url')
    expect(webHtml).toContain('settings.web.token-copy')
    expect(webContainer.querySelector('#settings-web-url')?.textContent).toBe(window.location.origin)
    // No toasts fired — both clients stay quiet when the page
    // mounts. (The toast mock would catch any accidental error
    // reporting from a missing bridge call.)
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  test('copies the current browser origin with URL-specific feedback', async () => {
    seedWebBootstrap()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { container } = await renderPage()

    const copyUrlButton = container.querySelector<HTMLButtonElement>(
      `[aria-label="settings.web.url-copy: ${window.location.origin}"]`,
    )
    expect(copyUrlButton).not.toBeNull()
    await flushTestUpdates(async () => copyUrlButton?.click())

    expect(writeText).toHaveBeenCalledWith(window.location.origin)
    expect(toastMocks.success).toHaveBeenCalledWith('settings.web.url-copied')

    const url = container.querySelector('#settings-web-url')
    if (!url) throw new Error('missing current browser URL')
    await fireEvent.copy(url)
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  test('shows server-reported LAN addresses in the web runtime without a native LAN toggle', async () => {
    seedWebBootstrap()
    const lanUrl = 'http://192.168.1.20:32100'
    const { container } = await renderPage({
      lanInfo: { host: '0.0.0.0', port: 32100, lanUrls: [lanUrl] },
    })

    const html = container.innerHTML
    expect(html).toContain('settings.web.lan-urls')
    expect(html).toContain(lanUrl)
    expect(html).not.toContain('settings.lan.enabled')
    expect(html).not.toContain('0.0.0.0')
  })
})

vi.mock('vue-sonner', () => ({
  toast: toastMocks,
}))

vi.mock('#/web/lib/server-fetch.ts', () => ({
  fetchServerJson: fetchServerJsonMock,
}))
