import { LANG_VALUES, type Lang, type LangPref } from '#/shared/settings.ts'

function localeCandidates(input: string | null | undefined): string[] {
  return String(input ?? '')
    .split(',')
    .map((part) => part.split(';', 1)[0]?.trim().toLowerCase() ?? '')
    .filter((part) => part.length > 0)
}

function matchSupportedLang(locale: string): Lang | null {
  for (const supported of LANG_VALUES) {
    if (locale === supported || locale.startsWith(`${supported}-`)) return supported
  }
  return null
}

export function resolveAutoLang(locale: string | null | undefined): Lang {
  for (const candidate of localeCandidates(locale)) {
    const match = matchSupportedLang(candidate)
    if (match) return match
  }
  return 'en'
}

export function resolvePreferredLang(pref: LangPref, locale: string | null | undefined): Lang {
  return pref === 'auto' ? resolveAutoLang(locale) : pref
}
