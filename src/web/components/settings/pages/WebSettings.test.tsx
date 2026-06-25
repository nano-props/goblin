// @vitest-environment jsdom

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WebSettings } from '#/web/components/settings/pages/WebSettings.tsx'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

const testWindow = window as unknown as {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
let container: HTMLDivElement | null = null
let root: Root | null = null
let queryClient: QueryClient | null = null

beforeEach(() => {
  setClientBridgeForTests(null)
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  queryClient?.clear()
  queryClient = null
  document.body.innerHTML = ''
  delete testWindow.goblinNative
  delete testWindow.__GOBLIN_BOOTSTRAP__
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

async function renderPage() {
  container = document.createElement('div')
  document.body.appendChild(container)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <QueryClientProvider client={queryClient!}>
        <WebSettings />
      </QueryClientProvider>,
    )
    await Promise.resolve()
  })
}

function seedElectronBootstrap() {
  testWindow.__GOBLIN_BOOTSTRAP__ = {
    runtime: {
      kind: 'electron',
      bridgeVersion: 1,
      capabilities: [
        'settings-ipc',
        'open-settings-window',
        'open-external-url',
        'open-directory-dialog',
        'consume-external-open-paths',
        'open-in-finder',
        'terminal-notifications',
        'terminal-badge',
      ],
    },
    initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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
    shell: () => null,
    terminal: () => ({
      attach: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      restart: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      write: vi.fn(async () => false),
      resize: vi.fn(async () => false),
      takeover: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      close: vi.fn(async () => false),
      create: vi.fn(async () => ({
        ok: true as const,
        action: 'created' as const,
        key: 'k',
        sessions: [],
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
      })),
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      listSessions: vi.fn(async () => []),
      prewarm: vi.fn(async () => {}),
      kickReconnect: vi.fn(() => {}),
      getSlotSnapshot: vi.fn(async () => null),
      notifyBell: vi.fn(async () => false),
      sendTestNotification: vi.fn(async () => false),
      setBadge: () => {},
      onOutput: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onIdentity: () => () => {},
        onLifecycle: () => () => {},
      onSessionsChanged: () => () => {},
      onSlotClosed: () => () => {},
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
    shell: () => null,
    terminal: () => ({
      attach: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      restart: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      write: vi.fn(async () => false),
      resize: vi.fn(async () => false),
      takeover: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
      close: vi.fn(async () => false),
      create: vi.fn(async () => ({
        ok: true as const,
        action: 'created' as const,
        key: 'k',
        sessions: [],
        ptySessionId: 'pty_session_1_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
      })),
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      listSessions: vi.fn(async () => []),
      prewarm: vi.fn(async () => {}),
      kickReconnect: vi.fn(() => {}),
      getSlotSnapshot: vi.fn(async () => null),
      notifyBell: vi.fn(async () => false),
      sendTestNotification: vi.fn(async () => false),
      setBadge: () => {},
      onOutput: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onIdentity: () => () => {},
        onLifecycle: () => () => {},
      onSessionsChanged: () => () => {},
      onSlotClosed: () => () => {},
    }),
  })
}

describe('WebSettings runtime parity', () => {
  test('exposes the Rotate token button and LAN section in the Electron runtime', async () => {
    seedElectronBootstrap()
    await renderPage()

    const html = container!.innerHTML
    expect(html).toContain('settings.web.token-rotate')
    expect(html).toContain('settings.lan.enabled')
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
    await renderPage()

    const html = container!.innerHTML
    expect(html).not.toContain('settings.web.token-rotate')
    expect(html).not.toContain('settings.lan.enabled')
  })

  test('still shows the server URL and token copy button in both runtimes', async () => {
    // The shared surface (URL display, token copy, QR codes when
    // LAN URLs are present) must render in both runtimes so the
    // web operator can still paste the access token into the
    // auth gate. Regression guard for the cross-runtime split
    // accidentally dropping the shared chrome.
    seedElectronBootstrap()
    await renderPage()
    const electronHtml = container!.innerHTML
    expect(electronHtml).toContain('settings.web.url')
    expect(electronHtml).toContain('settings.web.token-copy')

    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = null
    root = null
    queryClient?.clear()
    queryClient = null

    seedWebBootstrap()
    await renderPage()
    const webHtml = container!.innerHTML
    expect(webHtml).toContain('settings.web.url')
    expect(webHtml).toContain('settings.web.token-copy')
    // No toasts fired — both clients stay quiet when the page
    // mounts. (The toast mock would catch any accidental error
    // reporting from a missing bridge call.)
    expect(toastMocks.error).not.toHaveBeenCalled()
  })
})

vi.mock('sonner', () => ({
  toast: toastMocks,
}))
