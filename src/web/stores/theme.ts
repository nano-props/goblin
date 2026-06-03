// Renderer-side mirror of main's theme state. Hydrate at boot pulls
// `{pref, resolved, colorTheme}` over IPC; the subscription keeps html[data-theme]
// in lock-step with cross-window changes (and OS-appearance flips when
// pref === 'auto'). Renderers don't read prefers-color-scheme on their
// own — main is the single source of truth.

import { create } from 'zustand'
import { DEFAULT_COLOR_THEME, isColorTheme } from '#/shared/color-theme.ts'
import type { ResolvedTheme, ThemePref, ThemeState } from '#/shared/rpc.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import { getThemeState, setThemeColorTheme, setThemePref } from '#/web/app-data-client.ts'
import { subscribeSettingsRefetch } from '#/web/settings-sync-subscription.ts'

interface ThemeStore extends ThemeState {
  setPref: (pref: ThemePref) => Promise<void>
  setColorTheme: (colorTheme: ColorTheme) => Promise<void>
  hydrate: () => Promise<void>
}

let unsubscribe: (() => void) | null = null
let hydrateVersion = 0

function applyHtmlAttrs(resolved: ResolvedTheme, colorTheme: ColorTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.setAttribute('data-color-theme', colorTheme)
}

function clearThemeSubscription() {
  unsubscribe?.()
  unsubscribe = null
}

function colorThemeFromHtmlAttr(): ColorTheme {
  const value = document.documentElement.getAttribute('data-color-theme')
  return isColorTheme(value) ? value : DEFAULT_COLOR_THEME
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // index.html's boot script sets theme attrs before stylesheets
  // load — read it back here so the initial render doesn't disagree
  // with first paint.
  pref: 'auto',
  resolved: (document.documentElement.getAttribute('data-theme') as ResolvedTheme) ?? 'light',
  colorTheme: colorThemeFromHtmlAttr(),

  async hydrate() {
    const version = ++hydrateVersion
    const state = await getThemeState()
    if (version !== hydrateVersion) return
    applyHtmlAttrs(state.resolved, state.colorTheme)
    set((s) =>
      s.pref === state.pref && s.resolved === state.resolved && s.colorTheme === state.colorTheme ? s : state,
    )
    if (version !== hydrateVersion) return
    const nextUnsubscribe = subscribeSettingsRefetch({
      scope: 'theme',
      fetch: getThemeState,
      label: 'theme',
      apply: (next) => {
        applyHtmlAttrs(next.resolved, next.colorTheme)
        set((s) =>
          s.pref === next.pref && s.resolved === next.resolved && s.colorTheme === next.colorTheme ? s : next,
        )
      },
    })
    if (version !== hydrateVersion) {
      nextUnsubscribe()
      return
    }
    clearThemeSubscription()
    unsubscribe = nextUnsubscribe
  },

  async setPref(pref) {
    if (pref === get().pref) return
    const next = await setThemePref(pref)
    applyHtmlAttrs(next.resolved, next.colorTheme)
    set((s) => (s.pref === next.pref && s.resolved === next.resolved && s.colorTheme === next.colorTheme ? s : next))
  },

  async setColorTheme(colorTheme) {
    if (colorTheme === get().colorTheme) return
    const next = await setThemeColorTheme(colorTheme)
    applyHtmlAttrs(next.resolved, next.colorTheme)
    set((s) => (s.pref === next.pref && s.resolved === next.resolved && s.colorTheme === next.colorTheme ? s : next))
  },
}))
