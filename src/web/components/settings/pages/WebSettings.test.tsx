// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WebSettings } from '#/web/components/settings/pages/WebSettings.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { lanInfoQueryKey, settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import type { LanInfo } from '#/shared/api-types.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  setClientBridgeForTests(null)
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
})

async function renderPage(options: { lanInfo?: LanInfo; lanEnabled?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(settingsSnapshotQueryKey(), defaultSettingsSnapshot({ lanEnabled: options.lanEnabled }))
  if (options.lanInfo) queryClient.setQueryData(lanInfoQueryKey(), options.lanInfo)
  return renderInJsdom(
    <QueryClientProvider client={queryClient}>
      <WebSettings />
    </QueryClientProvider>,
  )
}

function seedElectronBootstrap() {
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'electron',
      bridgeVersion: 1,
      capabilities: [
        'global-shortcut',
        'open-settings-window',
        'open-external-url',
        'open-directory-dialog',
        'consume-external-open-paths',
        'terminal-notifications',
        'terminal-badge',
      ],
    },
    // Normal Electron sessions are same-origin and do not use the one-time
    // QR/login handoff snapshot.
    initialServer: null,
  }
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: () => true,
    getBootstrap: () => testWindow.__GOBLIN_BOOTSTRAP__ as never,
    invokeIpc: vi.fn(async () => undefined),
    abortIpc: vi.fn(async () => true),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: () => '',
    saveClipboardFiles: vi.fn(async () => []),
    host: () => null,
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
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      recoverSessions: vi.fn(async () => ({ revision: 0, sessions: [] })),
      notifyBell: vi.fn(async () => false),
      sendTestNotification: vi.fn(async () => false),
      setBadge: () => {},
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
      replace: vi.fn(async () => ({ revision: 0, entries: [] })),
      update: vi.fn(async () => ({ revision: 0, entries: [] })),
      list: vi.fn(async () => ({ revision: 0, entries: [] })),
      onChanged: () => () => {},
    }),
    workspacePaneRuntime: () => ({
      open: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
      close: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
    }),
    rotateAccessToken: vi.fn(async () => ({ accessToken: 'rotated-secret' })),
  })
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
  // Web runtime: no `goblinNative` preload surface, no rotate
  // capability. The client falls through to the safe defaults
  // in `client-bridge.ts`.
  delete testWindow.goblinNative
  setClientBridgeForTests({
    kind: () => 'web',
    hasCapability: () => false,
    getBootstrap: () => testWindow.__GOBLIN_BOOTSTRAP__ as never,
    invokeIpc: vi.fn(async () => {
      throw new Error('Goblin bridge is unavailable in this runtime')
    }),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: () => '',
    saveClipboardFiles: vi.fn(async () => []),
    host: () => null,
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
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      recoverSessions: vi.fn(async () => ({ revision: 0, sessions: [] })),
      notifyBell: vi.fn(async () => false),
      sendTestNotification: vi.fn(async () => false),
      setBadge: () => {},
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
      replace: vi.fn(async () => ({ revision: 0, entries: [] })),
      update: vi.fn(async () => ({ revision: 0, entries: [] })),
      list: vi.fn(async () => ({ revision: 0, entries: [] })),
      onChanged: () => () => {},
    }),
    workspacePaneRuntime: () => ({
      open: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
      close: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
    }),
  })
}

describe('WebSettings runtime parity', () => {
  test('exposes the Rotate token button and LAN section in the Electron runtime', async () => {
    seedElectronBootstrap()
    const { container } = await renderPage({
      lanInfo: { host: '127.0.0.1', port: 32100, lanUrls: [] },
      lanEnabled: false,
    })

    const html = container.innerHTML
    expect(html).toContain('settings.web.token-rotate')
    expect(html).toContain('settings.lan.enabled')
    expect(html).toContain('settings.lan.local-only')
  })

  test('hides the Rotate token button and LAN section in the web runtime', async () => {
    // Cross-runtime parity: in `bun run serve.sh` / standalone
    // web mode, the operator owns the server lifecycle. The
    // Rotate token action (which restarts the embedded server
    // via main) and the LAN-enabled toggle (which changes the
    // main-owned bind address) must not surface — clicking them
    // would no-op or surface a misleading error. The web
    // settings page is intentionally read-only on those axes.
    seedWebBootstrap()
    const { container } = await renderPage()

    const html = container.innerHTML
    expect(html).not.toContain('settings.web.token-rotate')
    expect(html).not.toContain('settings.lan.enabled')
  })

  test('shows the current browser origin and token copy button in both runtimes', async () => {
    // The current address is a property of the loaded page, not the optional
    // QR/login bootstrap handoff. Normal sessions must never regress to an
    // empty dash when `initialServer` is null.
    seedElectronBootstrap()
    const { container: electronContainer, unmount: unmountElectron } = await renderPage()
    const electronHtml = electronContainer.innerHTML
    expect(electronHtml).toContain('settings.web.url')
    expect(electronHtml).toContain('settings.web.token-copy')
    expect(electronContainer.querySelector('#settings-web-url')?.textContent).toBe(window.location.origin)

    act(() => {
      unmountElectron()
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

  test('describes a pending restart instead of claiming LAN access stopped immediately', async () => {
    seedElectronBootstrap()
    const lanUrl = 'http://192.168.1.20:32100'
    const { container } = await renderPage({
      lanInfo: { host: '0.0.0.0', port: 32100, lanUrls: [lanUrl] },
      lanEnabled: false,
    })

    const html = container.innerHTML
    expect(html).toContain('settings.lan.restart-hint')
    expect(html).not.toContain('settings.lan.local-only')
  })
})

vi.mock('sonner', () => ({
  toast: toastMocks,
}))
