import { DICTS } from '#/shared/i18n/dictionaries.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import type { I18nPayload, Lang, LangPref } from '#/shared/rpc.ts'

function preferredLangFromHeader(header: string | null | undefined): Lang {
  const value = (header ?? '').toLowerCase()
  if (value.includes('zh')) return 'zh'
  if (value.includes('ko')) return 'ko'
  if (value.includes('ja')) return 'ja'
  return 'en'
}

function resolveServerLang(pref: LangPref, acceptLanguage?: string | null): Lang {
  if (pref === 'en' || pref === 'zh' || pref === 'ko' || pref === 'ja') return pref
  return preferredLangFromHeader(acceptLanguage)
}

export async function getServerI18nPayload(acceptLanguage?: string | null): Promise<I18nPayload> {
  const prefs = await getServerSettingsPrefs()
  const lang = resolveServerLang(prefs.lang, acceptLanguage)
  return {
    lang,
    pref: prefs.lang,
    dict: DICTS[lang],
  }
}
