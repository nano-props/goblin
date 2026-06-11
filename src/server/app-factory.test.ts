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
    mode: 'worker-backed' as const,
    state: 'running' as const,
    workerRunning: true,
    workerPid: 1,
    workerStartedAt: 1,
    workerUptimeMs: 1,
    pendingRequests: 0,
    registeredSockets: 0,
    restartAttempts: 0,
    restartScheduled: false,
    shuttingDown: false,
    lastSuccessfulResponseAt: 1,
    lastExitCode: null,
    lastExitSignal: null,
    lastWorkerFailure: null,
  })),
  registerSocket: vi.fn(),
  unregisterSocket: vi.fn(),
  attach: vi.fn(),
  restart: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  takeover: vi.fn(),
  close: vi.fn(),
  notifyBell: vi.fn(),
  listSessions: vi.fn(),
  create: vi.fn(),
  prune: vi.fn(),
  getSessionSnapshot: vi.fn(),
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
})
