// Main-process i18n.
//
// One in-memory `currentLang` mirrors the user's setting (settings.lang
// resolved against `app.getLocale()` if 'auto'). Reads go through
// `t(key, params)`. Server-backed settings remain the persistence source
// of truth; this module only keeps the native menu/dialog projection that
// Electron needs at runtime.

import { app } from 'electron'
import { DICTS, en, type DictKey } from '#/shared/i18n/dictionaries.ts'
import { getSettingsPrefs, updateSettingsPrefs } from '#/main/settings-server-client.ts'
import type { I18nPayload, Lang, LangPref } from '#/shared/rpc.ts'

let currentLang: Lang = 'en'

/**
 * Verify every non-en dictionary has the same keys as en. Catches the
 * silent-fallback bug where a translator forgets to copy a new key —
 * `t()` would return the en string, hiding the miss until somebody
 * happens to switch language and notice.
 *
 * Throws in dev (so first-run after adding a key fails fast); warns in
 * production (one missing key shouldn't refuse to boot a packaged app).
 */
export function assertDictionaryParity(isDev: boolean): void {
  const enKeys = new Set(Object.keys(en) as DictKey[])
  const issues: string[] = []
  for (const lang of ['zh', 'ko', 'ja'] as const) {
    const dict = DICTS[lang] as Record<string, string>
    const dictKeys = new Set(Object.keys(dict))
    for (const k of enKeys) {
      if (!dictKeys.has(k)) issues.push(`${lang}: missing key "${k}"`)
    }
    for (const k of dictKeys) {
      if (!enKeys.has(k as DictKey)) issues.push(`${lang}: stray key "${k}" not in en`)
    }
  }
  if (issues.length === 0) return
  const msg = `[i18n] dictionary parity broken:\n  ${issues.join('\n  ')}`
  if (isDev) throw new Error(msg)
  console.warn(msg)
}

/**
 * Map the OS locale to a supported lang. Falls back to 'en'.
 */
export function resolveLang(pref: LangPref): Lang {
  if (pref === 'en' || pref === 'zh' || pref === 'ko' || pref === 'ja') return pref
  const sys = (app.getLocale() || 'en').toLowerCase()
  if (sys.startsWith('zh')) return 'zh'
  if (sys.startsWith('ko')) return 'ko'
  if (sys.startsWith('ja')) return 'ja'
  return 'en'
}

export function setCurrentLang(lang: Lang): void {
  if (currentLang === lang) return
  currentLang = lang
}

export function getCurrentLang(): Lang {
  return currentLang
}

export function t(key: DictKey, params?: Record<string, string | number>): string {
  const dict = DICTS[currentLang]
  const raw = dict[key] ?? en[key] ?? String(key)
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name) => {
    const v = params[name]
    return v == null ? m : String(v)
  })
}

export function getDictionary(): Record<DictKey, string> {
  return DICTS[currentLang]
}

export async function getLangPref(): Promise<LangPref> {
  return (await getSettingsPrefs()).lang
}

export async function applyLangPref(pref: LangPref): Promise<I18nPayload | null> {
  const currentPref = await getLangPref()
  const nextPref = (await updateSettingsPrefs({ lang: pref })).lang
  const lang = resolveLang(nextPref)
  const changed = currentPref !== nextPref || currentLang !== lang
  setCurrentLang(lang)
  return changed ? { lang, pref: nextPref, dict: getDictionary() } : null
}
