// Renderer-side i18n. Hydrate at boot pulls the dictionary; setPref
// writes through and the broadcast keeps every window in sync.
// React components read translations through react-i18next, while this
// Zustand store keeps the language preference/snapshot available to
// non-hook call sites (Settings controls, ErrorBoundary fallback).

import i18next from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { create } from 'zustand'
import type { Lang, LangPref } from '#/renderer/types-bridge.ts'

export type { Lang, LangPref }
export type Dict = Record<string, string>

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} } },
  defaultNS: 'translation',
  keySeparator: false,
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
  react: {
    useSuspense: false,
  },
})

interface I18nState {
  lang: Lang
  pref: LangPref
  dict: Dict
  hydrate: () => Promise<void>
  setPref: (pref: LangPref) => Promise<void>
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: 'en',
  pref: 'auto',
  dict: {},

  async hydrate() {
    const payload = await window.gbl.i18n.get()
    await applyPayload(payload)
    set({ lang: payload.lang, pref: payload.pref, dict: payload.dict })
    document.documentElement.setAttribute('lang', payload.lang)
    window.gbl.i18n.onChange((next) => {
      void (async () => {
        await applyPayload(next)
        set({ lang: next.lang, pref: next.pref, dict: next.dict })
        document.documentElement.setAttribute('lang', next.lang)
      })().catch((err) => {
        console.warn('[i18n] change failed', err)
      })
    })
  },

  async setPref(pref) {
    const payload = await window.gbl.i18n.setPref(pref)
    if (payload) {
      await applyPayload(payload)
      set({ lang: payload.lang, pref: payload.pref, dict: payload.dict })
      document.documentElement.setAttribute('lang', payload.lang)
    }
  },
}))

async function applyPayload(payload: { lang: Lang; dict: Dict }): Promise<void> {
  i18next.addResourceBundle(payload.lang, 'translation', payload.dict, true, true)
  await i18next.changeLanguage(payload.lang)
}

/** Render-bound translator backed by react-i18next. */
export function useT() {
  const { t } = useTranslation()
  return (key: string, params?: Record<string, string | number>) => {
    return t(key, params) as string
  }
}
