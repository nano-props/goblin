// Renderer-side mirror of main's theme state. Hydrate at boot pulls
// `{pref, resolved}` over IPC; the subscription keeps html[data-theme]
// in lock-step with cross-window changes (and OS-appearance flips when
// pref === 'auto'). Renderers don't read prefers-color-scheme on their
// own — main is the single source of truth.

import { create } from 'zustand'
import type { ResolvedTheme, ThemePref, ThemeState } from '#/renderer/types-bridge.ts'
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'

interface ThemeStore extends ThemeState {
  setPref: (pref: ThemePref) => Promise<void>
  hydrate: () => Promise<void>
}

let unsubscribe: (() => void) | null = null
let hydrateVersion = 0

function applyHtmlAttr(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
}

function clearThemeSubscription() {
  unsubscribe?.()
  unsubscribe = null
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  // index.html's inline boot script sets data-theme before stylesheets
  // load — read it back here so the initial render doesn't disagree
  // with first paint.
  pref: 'auto',
  resolved: (document.documentElement.getAttribute('data-theme') as ResolvedTheme) ?? 'light',

  async hydrate() {
    const version = ++hydrateVersion
    const state = await rpc.theme.get.query()
    if (version !== hydrateVersion) return
    applyHtmlAttr(state.resolved)
    set((s) => (s.pref === state.pref && s.resolved === state.resolved ? s : state))
    if (version !== hydrateVersion) return
    const nextUnsubscribe = onRpcEventType('theme-changed', (event) => {
      const next = event.state
      applyHtmlAttr(next.resolved)
      set((s) => (s.pref === next.pref && s.resolved === next.resolved ? s : next))
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
    const next = await rpc.theme.setPref.mutate({ pref })
    applyHtmlAttr(next.resolved)
    set((s) => (s.pref === next.pref && s.resolved === next.resolved ? s : next))
  },
}))
