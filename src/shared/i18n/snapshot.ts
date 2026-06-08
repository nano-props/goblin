import { DICTS } from '#/shared/i18n/dictionaries.ts'
import { resolvePreferredLang } from '#/shared/i18n/resolve-lang.ts'
import type { Lang, LangPref } from '#/shared/rpc.ts'
import type { I18nSnapshot } from '#/shared/rpc.ts'

function cloneI18nDict(lang: Lang): Record<string, string> {
  return { ...DICTS[lang] }
}

export function buildI18nSnapshot(input: { lang: Lang; pref: LangPref }): I18nSnapshot {
  return {
    lang: input.lang,
    pref: input.pref,
    dict: cloneI18nDict(input.lang),
  }
}

export function resolveI18nSnapshot(pref: LangPref, locale: string | null | undefined): I18nSnapshot {
  return buildI18nSnapshot({
    lang: resolvePreferredLang(pref, locale),
    pref,
  })
}
