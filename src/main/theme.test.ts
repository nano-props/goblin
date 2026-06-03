import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  shouldUseDarkColors: false,
  themeSource: 'system',
  nativeThemeOn: vi.fn(),
  getSettingsPrefs: vi.fn<
    () => Promise<{ theme?: 'auto' | 'light' | 'dark'; colorTheme?: 'macos' | 'mono' | 'github' }>
  >(async () => ({ theme: 'auto', colorTheme: 'macos' })),
  updateSettingsPrefs: vi.fn(async (patch: Record<string, unknown>) => patch),
}))

vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return mocks.shouldUseDarkColors
    },
    set shouldUseDarkColors(value: boolean) {
      mocks.shouldUseDarkColors = value
    },
    get themeSource() {
      return mocks.themeSource
    },
    set themeSource(value: string) {
      mocks.themeSource = value
    },
    on: mocks.nativeThemeOn,
  },
}))

vi.mock('#/main/settings-server-facade.ts', () => ({
  getSettingsPrefs: mocks.getSettingsPrefs,
  updateSettingsPrefs: mocks.updateSettingsPrefs,
}))

describe('theme persistence mirroring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.shouldUseDarkColors = false
    mocks.themeSource = 'system'
    mocks.getSettingsPrefs.mockResolvedValue({ theme: 'auto', colorTheme: 'macos' })
    mocks.updateSettingsPrefs.mockImplementation(async (patch: Record<string, unknown>) => ({ theme: 'auto', colorTheme: 'macos', ...patch }))
  })

  test('mirrors theme preference changes to the embedded server settings repository', async () => {
    const theme = await import('#/main/theme.ts')
    await theme.initTheme()

    const next = await theme.setThemePref('dark')

    expect(next.pref).toBe('dark')
    expect(mocks.updateSettingsPrefs).toHaveBeenCalledWith({ theme: 'dark' })
  })

  test('mirrors color theme changes to the embedded server settings repository', async () => {
    const theme = await import('#/main/theme.ts')
    await theme.initTheme()

    const next = await theme.setColorTheme('github')

    expect(next.colorTheme).toBe('github')
    expect(mocks.updateSettingsPrefs).toHaveBeenCalledWith({ colorTheme: 'github' })
  })

  test('initializes theme state from embedded server prefs when available', async () => {
    mocks.getSettingsPrefs.mockResolvedValueOnce({ theme: 'dark', colorTheme: 'github' })
    const theme = await import('#/main/theme.ts')

    await theme.initTheme()

    expect(theme.getTheme()).toMatchObject({ pref: 'dark', colorTheme: 'github', resolved: 'dark' })
  })
})
