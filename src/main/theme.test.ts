import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  shouldUseDarkColors: false,
  themeSource: 'system',
  nativeThemeOn: vi.fn(),
  getUserSettings: vi.fn<
    () => Promise<{ theme?: 'auto' | 'light' | 'dark'; colorTheme?: 'macos' | 'mono' | 'github' }>
  >(async () => ({ theme: 'auto', colorTheme: 'macos' })),
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

vi.mock('#/main/settings-server-client.ts', () => ({
  getUserSettings: mocks.getUserSettings,
}))

describe('theme persistence mirroring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.shouldUseDarkColors = false
    mocks.themeSource = 'system'
    mocks.getUserSettings.mockResolvedValue({ theme: 'auto', colorTheme: 'macos' })
  })

  test('initializes theme state from embedded server prefs when available', async () => {
    mocks.getUserSettings.mockResolvedValueOnce({ theme: 'dark', colorTheme: 'github' })
    const theme = await import('#/main/theme.ts')

    await theme.initTheme()

    expect(theme.getTheme()).toMatchObject({ pref: 'dark', colorTheme: 'github', resolved: 'dark' })
  })
})
