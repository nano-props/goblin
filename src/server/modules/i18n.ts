import { DICTS } from '#/shared/i18n/dictionaries.ts'
import { resolvePreferredLang } from '#/shared/i18n/resolve-lang.ts'
import { getServerSettingsPrefs } from '#/server/modules/settings-source.ts'
import type { I18nPayload, SettingsPrefs } from '#/shared/rpc.ts'

export function buildServerI18nPayload(settings: Pick<SettingsPrefs, 'lang'>, acceptLanguage?: string | null): I18nPayload {
  const lang = resolvePreferredLang(settings.lang, acceptLanguage)
  return {
    lang,
    pref: settings.lang,
    dict: DICTS[lang],
  }
}

export async function getServerI18nPayload(acceptLanguage?: string | null): Promise<I18nPayload> {
  return buildServerI18nPayload(await getServerSettingsPrefs(), acceptLanguage)
}
