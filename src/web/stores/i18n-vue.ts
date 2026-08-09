import { createI18n, useI18n } from 'vue-i18n'
import { i18nStore } from '#/web/stores/i18n.ts'
import type { I18nDictionary } from '#/web/stores/i18n.ts'

const initialLocale: string = 'en'
const initialMessages: Record<string, I18nDictionary> = { en: {} }

export const appI18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  flatJson: true,
  missingWarn: false,
  fallbackWarn: false,
  messages: initialMessages,
})

export function startI18nProjection(): () => void {
  applyI18nProjection(i18nStore.getState())
  return i18nStore.subscribe((state, previous) => {
    if (state.lang === previous.lang && state.dict === previous.dict) return
    applyI18nProjection(state)
  })
}

function applyI18nProjection(state: { lang: string; dict: I18nDictionary }): void {
  appI18n.global.setLocaleMessage(state.lang, { ...state.dict })
  appI18n.global.locale.value = state.lang
  document.documentElement.setAttribute('lang', state.lang)
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const { t } = useI18n({ useScope: 'global' })
  return (key, params) => t(key, params ?? {})
}

export function translate(key: string, params?: Record<string, string | number>): string {
  return appI18n.global.t(key, params ?? {})
}
