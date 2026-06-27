import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultUserSettings, defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'

const mocks = vi.hoisted(() => ({
  getEmbeddedServerRuntime: vi.fn<() => { url: string; accessToken: string } | null>(() => ({
    url: 'http://127.0.0.1:32100/',
    accessToken: 'secret',
  })),
  requestEmbeddedServerJson: vi.fn(),
  postEmbeddedServerJson: vi.fn(),
}))

vi.mock('#/main/embedded-server-lifecycle.ts', () => ({
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
      accessToken: 'secret',
    })
  })

  test('loads the settings snapshot through the embedded server runtime', async () => {
    const snapshot = defaultSettingsSnapshot({ lang: 'ja', theme: 'dark', colorTheme: 'github' })
    mocks.requestEmbeddedServerJson.mockResolvedValueOnce(snapshot)

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getSettingsSnapshot()).resolves.toBe(snapshot)
    expect(mocks.requestEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      '/api/settings',
      undefined,
    )
  })

  test('loads settings prefs through the embedded server runtime', async () => {
    const prefs = defaultUserSettings({ lang: 'ja', theme: 'dark', colorTheme: 'github' })
    mocks.requestEmbeddedServerJson.mockResolvedValueOnce(prefs)

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getUserSettings()).resolves.toBe(prefs)
    expect(mocks.requestEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      '/api/settings/prefs',
      undefined,
    )
  })

  test('persists settings prefs patches through the embedded server runtime', async () => {
    const prefs = defaultUserSettings({ theme: 'dark', colorTheme: 'github', globalShortcut: 'Alt+K' })
    mocks.postEmbeddedServerJson.mockResolvedValueOnce({ settings: prefs })

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.updateUserSettings({ theme: 'dark' })).resolves.toBe(prefs)
    expect(mocks.postEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      '/api/settings/prefs',
      { prefs: { theme: 'dark' } },
    )
  })

  test('persists global shortcut registration state through the embedded server runtime', async () => {
    mocks.postEmbeddedServerJson.mockResolvedValueOnce({ registered: true })

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.setGlobalShortcutState(true)).resolves.toBe(true)
    expect(mocks.postEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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
