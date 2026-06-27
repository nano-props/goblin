// Native projection for the user's server-backed theme preference:
// pref ('auto' | 'light' | 'dark') persists in settings; resolved
// ('light' | 'dark') is computed against `nativeTheme.shouldUseDarkColors`
// when pref === 'auto'. Main owns the Electron-native projection and
// emits updates, but it is not the persistence source of truth.

import { nativeTheme } from 'electron'
import { getUserSettings } from '#/main/settings-server-client.ts'
import { themeNodeLog } from '#/node/logger.ts'
import { DEFAULT_COLOR_THEME } from '#/shared/settings-defaults.ts'
import type { ResolvedTheme, ThemePref, ThemeState } from '#/shared/api-types.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'

type Listener = (state: ThemeState) => void

let currentPref: ThemePref = 'auto'
let currentResolved: ResolvedTheme = 'light'
let currentColorTheme: ColorTheme = DEFAULT_COLOR_THEME
const listeners = new Set<Listener>()
let inited = false
let transitionDepth = 0

function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function applyToNativeTheme(pref: ThemePref): void {
  // Drive native dialogs / menus to match the user's pick.
  nativeTheme.themeSource = pref === 'auto' ? 'system' : pref
}

function emit(): void {
  const state: ThemeState = { pref: currentPref, resolved: currentResolved, colorTheme: currentColorTheme }
  for (const l of listeners) {
    try {
      l(state)
    } catch (err) {
      themeNodeLog.warn({ err }, 'listener threw')
    }
  }
}

export async function initTheme(initial?: { theme: ThemePref; colorTheme: ColorTheme }): Promise<void> {
  if (inited) return
  inited = true
  const serverSettings = initial ?? (await getUserSettings())
  applyThemeSettingsProjection({ theme: serverSettings.theme, colorTheme: serverSettings.colorTheme })

  // Fires both on OS appearance changes AND when we assign themeSource
  // ourselves. We only care about the former, only when pref === 'auto'.
  nativeTheme.on('updated', () => {
    if (transitionDepth > 0) return
    if (currentPref !== 'auto') return
    const next = resolveTheme('auto')
    if (next === currentResolved) return
    currentResolved = next
    emit()
  })
}

export function getTheme(): ThemeState {
  return { pref: currentPref, resolved: currentResolved, colorTheme: currentColorTheme }
}

export function applyThemeSettingsProjection(input: { theme: ThemePref; colorTheme: ColorTheme }): ThemeState {
  transitionDepth++
  try {
    const nextPref = input.theme
    const nextColorTheme = input.colorTheme
    applyToNativeTheme(nextPref)
    const nextResolved = resolveTheme(nextPref)
    if (currentPref === nextPref && currentResolved === nextResolved && currentColorTheme === nextColorTheme) {
      return getTheme()
    }
    currentPref = nextPref
    currentResolved = nextResolved
    currentColorTheme = nextColorTheme
    emit()
    return getTheme()
  } finally {
    transitionDepth--
  }
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
