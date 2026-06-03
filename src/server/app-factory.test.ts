import { beforeEach, describe, expect, test, vi } from 'vitest'

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
  })),
}))

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
})
