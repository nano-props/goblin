import type { Lang, LangPref } from '#/shared/rpc.ts'

const SUPPORTED_LANGS = ['zh', 'ko', 'ja', 'en'] as const satisfies readonly Lang[]

function localeCandidates(input: string | null | undefined): string[] {
  return String(input ?? '')
    .split(',')
    .map((part) => part.split(';', 1)[0]?.trim().toLowerCase() ?? '')
    .filter((part) => part.length > 0)
}

function matchSupportedLang(locale: string): Lang | null {
  for (const supported of SUPPORTED_LANGS) {
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
  if (pref === 'en' || pref === 'zh' || pref === 'ko' || pref === 'ja') return pref
  return resolveAutoLang(locale)
}
