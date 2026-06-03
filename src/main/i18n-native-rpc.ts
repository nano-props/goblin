import { setMenuLangPref } from '#/main/menu-state.ts'
import { applyLangPref, getCurrentLang, getDictionary, getLangPref } from '#/main/i18n/index.ts'
import { applyI18nEffects } from '#/main/settings-native-effects.ts'
import type { AppRpcHandlers } from '#/shared/rpc.ts'

export function createI18nNativeRpcHandlers(): Pick<AppRpcHandlers, 'i18n'> {
  return {
    i18n: {
      get: async () => ({
        lang: getCurrentLang(),
        pref: await getLangPref(),
        dict: getDictionary(),
      }),
      setPref: async ({ pref }) => {
        if (pref !== 'auto' && pref !== 'en' && pref !== 'zh' && pref !== 'ko' && pref !== 'ja') return null
        const payload = await applyLangPref(pref)
        if (!payload) return null
        setMenuLangPref(payload.pref)
        applyI18nEffects(payload)
        return payload
      },
    },
  }
}
