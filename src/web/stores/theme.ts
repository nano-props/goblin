// Client-side view of server-backed theme settings. Hydrate reads
// `{pref, colorTheme}` from the embedded server snapshot and derives
// the resolved browser theme locally. When `pref === 'auto'`, the
// client also listens for `(prefers-color-scheme: dark)` changes so
// OS appearance flips propagate without a server round-trip —
// Chromium's matchMedia tracks `nativeTheme` in Electron, so this
// covers both the desktop and plain-browser repoOperationSchedulers. Electron main
// still projects the server-owned preference into native host state,
// but it is not the business source of truth.
// Theme hydration can read the transport snapshot directly; theme writes go
// through settings-actions.

import { create, type StoreApi } from 'zustand'
import { DEFAULT_COLOR_THEME, isColorTheme } from '#/shared/color-theme.ts'
import type { ResolvedTheme, SettingsSnapshot, ThemePref, ThemeState } from '#/shared/api-types.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import { getThemeState, resolveThemeStateFromSettings } from '#/web/settings-client.ts'
import { subscribeSettingsInvalidationRefetch } from '#/web/settings-invalidation-refetch.ts'
import { setThemeColorThemePreference, setThemePreference } from '#/web/settings-actions.ts'

interface ThemeStore extends ThemeState {
  setPref: (pref: ThemePref) => Promise<void>
  setColorTheme: (colorTheme: ColorTheme) => Promise<void>
  hydrate: () => Promise<void>
  hydrateFromSettingsSnapshot: (snapshot: Pick<SettingsSnapshot, 'theme' | 'colorTheme'>) => Promise<void>
}

// `set` / `get` aliases keep helper signatures aligned with the
// `I18nSet` / `ReposSet` / `ReposGet` precedent in
// `src/web/stores/i18n.ts` and `src/web/stores/repos/types.ts` —
// helpers wrap the actual Zustand setState/getState rather than a
// narrowed alias of either.
type ThemeSet = StoreApi<ThemeStore>['setState']
type ThemeGet = StoreApi<ThemeStore>['getState']

const PREFERS_DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

let unsubscribe: (() => void) | null = null
let mediaQueryListenerDisposer: (() => void) | null = null
let hydrateVersion = 0

function applyHtmlAttrs(resolved: ResolvedTheme, colorTheme: ColorTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
  document.documentElement.setAttribute('data-color-theme', colorTheme)
}

function clearThemeSubscription() {
  unsubscribe?.()
  unsubscribe = null
}

function clearMediaQueryListener() {
  mediaQueryListenerDisposer?.()
  mediaQueryListenerDisposer = null
}

function colorThemeFromHtmlAttr(): ColorTheme {
  const value = document.documentElement.getAttribute('data-color-theme')
  return isColorTheme(value) ? value : DEFAULT_COLOR_THEME
}

function resolveOsTheme(): ResolvedTheme | null {
  // matchMedia is the only signal the client has for the OS
  // appearance — in Electron it tracks `nativeTheme` because the
  // client shares Chromium's media-query implementation with the
  // host process; in a plain browser it tracks the OS via the
  // browser's own plumbing. Either way the listener below covers
  // both repoOperationSchedulers.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia(PREFERS_DARK_MEDIA_QUERY).matches ? 'dark' : 'light'
}

// `commitThemeState` mirrors `commitSnapshot` in
// `src/web/stores/i18n.ts`: paint the HTML attrs first so any
// CSS-only consumer (e.g. `sonner`) flips in lockstep with the
// store, then ask Zustand to swap the slice only when it actually
// changed — that last bit is what keeps React subscribers from
// re-rendering on no-op writes.
function commitThemeState(set: ThemeSet, next: ThemeState): void {
  applyHtmlAttrs(next.resolved, next.colorTheme)
  set((s) => (s.pref === next.pref && s.resolved === next.resolved && s.colorTheme === next.colorTheme ? s : next))
}

// Only auto mode is OS-driven. Explicit 'light' / 'dark' picks pin
// the resolved value, so an OS flip must not clobber them.
function syncOsThemeIntoStore(set: ThemeSet, get: ThemeGet): void {
  if (get().pref !== 'auto') return
  const next = resolveOsTheme()
  if (!next || next === get().resolved) return
  applyHtmlAttrs(next, get().colorTheme)
  set({ resolved: next })
}

function installMediaQueryListener(set: ThemeSet, get: ThemeGet): void {
  clearMediaQueryListener()
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const mql = window.matchMedia(PREFERS_DARK_MEDIA_QUERY)
  if (!mql || typeof mql.addEventListener !== 'function') return
  // `addListener` / `removeListener` were deprecated in favor of
  // `addEventListener` on MediaQueryList a decade ago. Electron's
  // bundled Chromium and every browser this app ships to support
  // the modern API, so the legacy fallback isn't worth carrying.
  const handleOsThemeChange = () => syncOsThemeIntoStore(set, get)
  mql.addEventListener('change', handleOsThemeChange)
  mediaQueryListenerDisposer = () => mql.removeEventListener('change', handleOsThemeChange)
}

function commitHydratedThemeState(set: ThemeSet, get: ThemeGet, version: number, state: ThemeState): void {
  if (version !== hydrateVersion) return
  commitThemeState(set, state)
  if (version !== hydrateVersion) return
  const nextUnsubscribe = subscribeSettingsInvalidationRefetch({
    scope: 'theme',
    fetch: getThemeState,
    label: 'theme',
    apply: (next) => commitThemeState(set, next),
  })
  if (version !== hydrateVersion) {
    nextUnsubscribe()
    return
  }
  clearThemeSubscription()
  unsubscribe = nextUnsubscribe
  installMediaQueryListener(set, get)
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
    commitHydratedThemeState(set, get, version, state)
  },

  async hydrateFromSettingsSnapshot(snapshot) {
    const version = ++hydrateVersion
    commitHydratedThemeState(set, get, version, resolveThemeStateFromSettings(snapshot))
  },

  async setPref(pref) {
    if (pref === get().pref) return
    const next = await setThemePreference(pref)
    commitThemeState(set, next)
  },

  async setColorTheme(colorTheme) {
    if (colorTheme === get().colorTheme) return
    const next = await setThemeColorThemePreference(colorTheme)
    commitThemeState(set, next)
  },
}))
