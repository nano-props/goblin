import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'

const mocks = vi.hoisted(() => ({
  access: vi.fn(async () => undefined),
  readFile: vi.fn(
    async () => `<!doctype html>
<html lang="en">
  <head>
    <script type="module" src="./boot.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`,
  ),
  getServerSettingsPrefs: vi.fn(async () => ({
    lang: 'auto',
    theme: 'auto',
    colorTheme: 'macos',
    fetchIntervalSec: 120,
    terminalNotificationsEnabled: false,
    shortcutsDisabled: false,
    globalShortcutDisabled: false,
    swapCloseShortcuts: false,
    toggleDetailOnActionBarBlankClick: false,
    globalShortcut: 'CommandOrControl+Shift+G',
    terminalApp: 'auto',
    editorApp: 'auto',
    lanEnabled: false,
  })),
}))

const terminalHostStub = {
  isValidClientId: (_value: unknown): _value is string => true,
  getDiagnostics: vi.fn(() => ({
    mode: 'in-process' as const,
    state: 'running' as const,
    registeredSockets: 0,
    shuttingDown: false,
    pty: {
      mode: 'in-process' as const,
      state: 'running' as const,
      workerRunning: false,
      workerPid: null,
      workerStartedAt: null,
      workerUptimeMs: null,
      pendingRequests: 0,
      restartAttempts: 0,
      restartScheduled: false,
      shuttingDown: false,
      lastSuccessfulResponseAt: null,
      lastExitCode: null,
      lastExitSignal: null,
      lastFailure: null,
    },
  })),
  registerSocket: vi.fn(),
  unregisterSocket: vi.fn(),
  attach: vi.fn(),
  restart: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  takeover: vi.fn(),
  close: vi.fn(),
  listSessions: vi.fn(),
  create: vi.fn(),
  prune: vi.fn(),
  getSessionSnapshot: vi.fn(),
  reorder: vi.fn(),
  handleRealtimeMessage: vi.fn(),
  shutdown: vi.fn(),
} satisfies ServerTerminalHost

vi.mock('node:fs/promises', () => ({
  access: mocks.access,
  readFile: mocks.readFile,
}))

vi.mock('#/server/modules/settings-source.ts', () => ({
  getServerSettingsPrefs: mocks.getServerSettingsPrefs,
}))

describe('server app body limit', () => {
  test('rejects POST bodies over 1 MiB with a 413 JSON response', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })
    const oversized = 'x'.repeat(2 * 1024 * 1024)
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/settings/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        },
        body: JSON.stringify({ session: { blob: oversized } }),
      }),
    )
    expect(response.status).toBe(413)
    const json = (await response.json()) as { ok: boolean; code: string }
    expect(json).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' })
  })

  test('accepts POST bodies under the limit and surfaces route errors normally', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })
    // A small, well-formed body: validation will run after the body
    // limit middleware, so we expect 400 (BAD_REQUEST) — not 413.
    const response = await app.request(
      new Request('http://127.0.0.1:32100/api/settings/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goblin-internal-secret': 'secret',
        },
        body: JSON.stringify({}),
      }),
    )
    expect(response.status).toBe(400)
  })
})

describe('server app html bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  test('injects bootstrap into the web index html for web requests', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })

    const response = await app.request(
      new Request('http://127.0.0.1:32100/', {
        headers: {
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }),
    )

    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('<script id="goblin-bootstrap" type="application/json">')
    expect(html).toContain('"secret"')
    expect(html).toContain('"lang":"zh"')
    expect(html).toContain('打开本地仓库')
  })

  test('resolves auto language from the first supported accept-language candidate', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })

    const response = await app.request(
      new Request('http://127.0.0.1:32100/', {
        headers: {
          'accept-language': 'fr-FR,ja;q=0.9,en;q=0.8',
        },
      }),
    )

    const html = await response.text()
    expect(response.status).toBe(200)
    expect(html).toContain('"lang":"ja"')
    expect(html).toContain('ローカルリポジトリを開く')
  })

  test('serves renderer html for settings routes', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })

    for (const path of ['/settings', '/settings/general']) {
      const response = await app.request(new Request(`http://127.0.0.1:32100${path}`))
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain('<script id="goblin-bootstrap" type="application/json">')
      expect(html).toContain('"secret"')
      expect(html).toContain('<base href="http://127.0.0.1:32100/">')
    }
  })

  test('serves renderer html for arbitrary deep-link paths (SPA fallback)', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })
    for (const path of ['/', '/repos/abc123', '/repos/abc123/changes']) {
      const response = await app.request(new Request(`http://127.0.0.1:32100${path}`))
      const html = await response.text()
      expect(response.status).toBe(200)
      expect(html).toContain('<script id="goblin-bootstrap" type="application/json">')
    }
  })

  test('returns JSON 404 (not the SPA shell) for unknown /api paths', async () => {
    const { createApp } = await import('#/server/app-factory.ts')
    const app = createApp({
      version: '0.1.0',
      startedAt: Date.now(),
      internalSecret: 'secret',
      terminalHost: terminalHostStub,
    })
    const response = await app.request(new Request('http://127.0.0.1:32100/api/unknown'))
    expect(response.status).toBe(404)
    const json = (await response.json()) as { ok: false; code: string }
    expect(json).toEqual({ ok: false, code: 'NOT_FOUND', message: expect.any(String) })
    // Make sure the catch-all didn't accidentally serve the HTML
    // shell (it would contain the bootstrap script).
    expect(response.headers.get('content-type')).toMatch(/application\/json/)
  })
})
