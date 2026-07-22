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
      expect.any(Function),
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
      expect.any(Function),
      undefined,
    )
  })

  test('persists settings prefs patches through the embedded server runtime', async () => {
    const prefs = defaultUserSettings({ theme: 'dark', colorTheme: 'github', globalShortcut: 'Alt+K' })
    mocks.postEmbeddedServerJson.mockResolvedValueOnce({ ok: true, prefs })

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.updateUserSettings({ theme: 'dark' })).resolves.toBe(prefs)
    expect(mocks.postEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      '/api/settings/prefs',
      { prefs: { theme: 'dark' } },
      expect.any(Function),
    )
  })

  test('persists global shortcut registration state through the embedded server runtime', async () => {
    mocks.postEmbeddedServerJson.mockResolvedValueOnce({ ok: true, registered: true })

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.setGlobalShortcutState(true)).resolves.toBe(true)
    expect(mocks.postEmbeddedServerJson).toHaveBeenCalledWith(
      { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      '/api/settings/global-shortcut-state',
      { registered: true },
      expect.any(Function),
    )
  })

  test.each([
    ['missing required field', { ...defaultUserSettings(), lang: undefined }],
    ['wrong field type', { ...defaultUserSettings(), shortcutsDisabled: 'false' }],
    ['unknown field', { ...defaultUserSettings(), legacyTheme: 'dark' }],
  ])('rejects a settings prefs response with %s', async (_name, payload) => {
    mocks.requestEmbeddedServerJson.mockImplementationOnce((_runtime, _path, decode) => decode(payload))

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getUserSettings()).rejects.toThrow('Embedded server rejected settings prefs request')
  })

  test('rejects a malformed settings update response', async () => {
    mocks.postEmbeddedServerJson.mockImplementationOnce(async (_runtime, _path, _body, decode) =>
      decode({ ok: true, prefs: defaultUserSettings(), legacy: true }),
    )

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.updateUserSettings({ theme: 'dark' })).rejects.toThrow('Embedded server rejected settings update')
  })

  test('rejects a malformed global shortcut response', async () => {
    mocks.postEmbeddedServerJson.mockImplementationOnce(async (_runtime, _path, _body, decode) =>
      decode({ ok: true, registered: 'true' }),
    )

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.setGlobalShortcutState(true)).rejects.toThrow(
      'Embedded server rejected global shortcut state update',
    )
  })

  test('rejects requests when the embedded server runtime is unavailable', async () => {
    mocks.getEmbeddedServerRuntime.mockReturnValueOnce(null)

    const mod = await import('#/main/settings-server-client.ts')
    await expect(mod.getSettingsSnapshot()).rejects.toThrow('Embedded server unavailable')
  })
})
