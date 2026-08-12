import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  shouldUseDarkColors: false,
  themeSource: 'system',
  nativeThemeOn: vi.fn(),
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

describe('theme persistence mirroring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.shouldUseDarkColors = false
    mocks.themeSource = 'system'
  })

  test('initializes theme state from the authoritative startup projection', async () => {
    const theme = await import('#/main/theme.ts')

    theme.initTheme({ theme: 'dark', colorTheme: 'github' })

    expect(theme.getTheme()).toMatchObject({ pref: 'dark', colorTheme: 'github', resolved: 'dark' })
  })
})
