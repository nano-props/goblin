import { getTheme, setColorTheme, setThemePref } from '#/main/theme.ts'
import type { AppRpcHandlers } from '#/shared/rpc.ts'

export function createThemeNativeRpcHandlers(): Pick<AppRpcHandlers, 'theme'> {
  return {
    theme: {
      get: () => getTheme(),
      setPref: async ({ pref }) => {
        if (pref !== 'auto' && pref !== 'light' && pref !== 'dark') return getTheme()
        return setThemePref(pref)
      },
      setColorTheme: async ({ colorTheme }) => setColorTheme(colorTheme),
    },
  }
}
