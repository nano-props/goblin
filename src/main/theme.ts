// Single source of truth for the user's theme. Mirrors deck-app's design:
// pref ('auto' | 'light' | 'dark') persists; resolved ('light' | 'dark')
// is computed against `nativeTheme.shouldUseDarkColors` when pref === 'auto'.
// Renderers pull `{ pref, resolved, colorTheme }` at boot and subscribe to changes —
// they never read prefers-color-scheme themselves.

import { nativeTheme } from 'electron'
import { loadSettings, setColorTheme as persistColorTheme, setThemePref as persistThemePref } from '#/main/settings.ts'
import { DEFAULT_COLOR_THEME, isColorTheme } from '#/shared/color-theme.ts'
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
  const settings = await loadSettings()
  currentPref = settings.theme
  currentColorTheme = settings.colorTheme
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
    await persistThemePref(pref)
    currentPref = pref
    applyToNativeTheme(pref)
    currentResolved = resolveTheme(pref)
    emit()
    return getTheme()
  } finally {
    transitionDepth--
  }
}

export async function setColorTheme(colorTheme: ColorTheme): Promise<ThemeState> {
  if (!isColorTheme(colorTheme)) return getTheme()
  if (colorTheme === currentColorTheme) return getTheme()
  currentColorTheme = await persistColorTheme(colorTheme)
  emit()
  return getTheme()
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
