import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultSettingsPrefs, defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => ({
  getEmbeddedServerRuntime: vi.fn<() => { url: string; secret: string; clientId: string } | null>(() => ({
    url: 'http://127.0.0.1:32100/',
    secret: 'secret',
    clientId: 'client_sharedterminal',
  })),
  requestEmbeddedServerJson: vi.fn(),
  postEmbeddedServerJson: vi.fn(),
}))

vi.mock('#/main/server-manager.ts', () => ({
  getEmbeddedServerRuntime: mocks.getEmbeddedServerRuntime,
}))

vi.mock('#/shared/embedded-server-client.ts', () => ({
  requestEmbeddedServerJson: mocks.requestEmbeddedServerJson,
  postEmbeddedServerJson: mocks.postEmbeddedServerJson,
}))

describe('main settings server client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getEmbeddedServerRuntime.mockReturnValue({
      url: 'http://127.0.0.1:32100/',
      secret: 'secret',
      clientId: 'client_sharedterminal',
    })
  })

  test('loads the settings snapshot through the embedded server runtime', async () => {
    const snapshot = defaultSettingsSnapshot({ lang: 'ja', theme: 'dark', colorTheme: 'github' })
    mocks.requestEmbeddedServerJson.mockResolvedValueOnce(snapshot)

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getSettingsSnapshot()).resolves.toBe(snapshot)
    expect(mocks.requestEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      '/api/settings',
      undefined,
    )
  })

  test('loads settings prefs through the embedded server runtime', async () => {
    const prefs = defaultSettingsPrefs({ lang: 'ja', theme: 'dark', colorTheme: 'github' })
    mocks.requestEmbeddedServerJson.mockResolvedValueOnce(prefs)

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getSettingsPrefs()).resolves.toBe(prefs)
    expect(mocks.requestEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      '/api/settings/prefs',
      undefined,
    )
  })

  test('persists settings prefs patches through the embedded server runtime', async () => {
    const prefs = defaultSettingsPrefs({ theme: 'dark', colorTheme: 'github', globalShortcut: 'Alt+K' })
    mocks.postEmbeddedServerJson.mockResolvedValueOnce({ settings: prefs })

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.updateSettingsPrefs({ theme: 'dark' })).resolves.toBe(prefs)
    expect(mocks.postEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      '/api/settings/prefs',
      { settings: { theme: 'dark' } },
    )
  })

  test('persists global shortcut registration state through the embedded server runtime', async () => {
    mocks.postEmbeddedServerJson.mockResolvedValueOnce({ registered: true })

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.setSettingsGlobalShortcutState(true)).resolves.toBe(true)
    expect(mocks.postEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      '/api/settings/global-shortcut-state',
      { registered: true },
    )
  })

  test('rejects requests when the embedded server runtime is unavailable', async () => {
    mocks.getEmbeddedServerRuntime.mockReturnValueOnce(null)

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getSettingsSnapshot()).rejects.toThrow('Embedded server unavailable')
  })
})
