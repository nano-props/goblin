// Native projection for the user's server-backed theme preference:
// pref ('auto' | 'light' | 'dark') persists in settings; resolved
// ('light' | 'dark') is computed against `nativeTheme.shouldUseDarkColors`
// when pref === 'auto'. Main owns the Electron-native projection and
// emits updates, but it is not the persistence source of truth.

import { nativeTheme } from 'electron'
import { getSettingsPrefs, updateSettingsPrefs } from '#/main/settings-server-facade.ts'
import { isColorTheme } from '#/shared/color-theme.ts'
import { DEFAULT_COLOR_THEME } from '#/shared/settings-defaults.ts'
import type { ResolvedTheme, ThemePref, ThemeState } from '#/shared/rpc.ts'
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
      console.warn('[theme] listener threw', err)
    }
  }
}

export async function initTheme(): Promise<void> {
  if (inited) return
  inited = true
  const serverSettings = await getSettingsPrefs()
  currentPref = serverSettings.theme
  currentColorTheme = serverSettings.colorTheme
  applyToNativeTheme(currentPref)
  currentResolved = resolveTheme(currentPref)

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

export async function setThemePref(pref: ThemePref): Promise<ThemeState> {
  if (pref === currentPref) return getTheme()
  transitionDepth++
  try {
    const serverSettings = await updateSettingsPrefs({ theme: pref })
    const nextPref = serverSettings.theme
    currentPref = nextPref
    applyToNativeTheme(nextPref)
    currentResolved = resolveTheme(nextPref)
    emit()
    return getTheme()
  } finally {
    transitionDepth--
  }
}

export async function setColorTheme(colorTheme: ColorTheme): Promise<ThemeState> {
  if (!isColorTheme(colorTheme)) return getTheme()
  if (colorTheme === currentColorTheme) return getTheme()
  const serverSettings = await updateSettingsPrefs({ colorTheme })
  currentColorTheme = serverSettings.colorTheme
  emit()
  return getTheme()
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
