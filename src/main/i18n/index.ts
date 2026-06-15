// Main-process i18n.
//
// One in-memory `currentLang` mirrors the user's setting (settings.lang
// resolved against `app.getLocale()` if 'auto'). Reads go through
// `t(key, params)`. Server-backed settings remain the persistence source
// of truth; this module only keeps the native menu/dialog projection that
// Electron needs at runtime.

import { app } from 'electron'
import { i18nNodeLog } from '#/node/logger.ts'
import { DICTS, en, type DictKey } from '#/shared/i18n/dictionaries.ts'
import { resolvePreferredLang } from '#/shared/i18n/resolve-lang.ts'
import type { Lang, LangPref } from '#/shared/api-types.ts'

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
  i18nNodeLog.warn({ issues }, 'dictionary parity broken')
}

/**
 * Map the OS locale to a supported lang. Falls back to 'en'.
 */
export function resolveLang(pref: LangPref): Lang {
  return resolvePreferredLang(pref, app.getLocale())
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

/**
 * Platform-aware i18n key for the "Open Data Folder" menu label and
 * error dialog. macOS users see "Finder", Windows users see "Explorer",
 * and other platforms get the generic fallback label.
 */
export function openDataFolderMenuKey():
  | 'menu.file.open-data-folder.mac'
  | 'menu.file.open-data-folder.win'
  | 'menu.file.open-data-folder' {
  if (process.platform === 'darwin') return 'menu.file.open-data-folder.mac'
  if (process.platform === 'win32') return 'menu.file.open-data-folder.win'
  return 'menu.file.open-data-folder'
}
