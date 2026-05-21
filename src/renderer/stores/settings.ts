// Renderer-side mirror of the persistable settings (excluding theme,
// which has its own dedicated store because of the broadcast machinery
// around dark/light flips).
//
// Hydrate at boot pulls the full snapshot via IPC; setters write
// through to main, which broadcasts changes so any other window we
// eventually open stays in sync.

import { create } from 'zustand'
import type { GlobalShortcutState, SessionState } from '#/renderer/types-bridge.ts'
import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/accelerator.ts'

interface SettingsStore {
  fetchIntervalSec: number
  shortcutsDisabled: boolean
  globalShortcut: string
  globalShortcutRegistered: boolean
  /** Saved session from previous run — consumed once by App.tsx during
   *  hydration, then irrelevant. We keep it in state for diagnostics. */
  savedSession: SessionState

  hydrate: () => Promise<SessionState>
  setFetchInterval: (sec: number) => Promise<void>
  setShortcutsDisabled: (disabled: boolean) => Promise<void>
  setGlobalShortcut: (accelerator: string) => Promise<GlobalShortcutState>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  fetchIntervalSec: 60,
  shortcutsDisabled: false,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutRegistered: false,
  savedSession: { openRepos: [], activeRepo: null, detailCollapsed: true },

  async hydrate() {
    const snap = await window.gbl.settings.get()
    set({
      fetchIntervalSec: snap.fetchIntervalSec,
      shortcutsDisabled: snap.shortcutsDisabled,
      globalShortcut: snap.globalShortcut,
      globalShortcutRegistered: snap.globalShortcutRegistered,
      savedSession: snap.session,
    })
    // Subscribe to interval changes pushed from main (e.g. settings
    // window in the future). Listener is process-lifetime — we don't
    // unsubscribe.
    window.gbl.settings.onFetchIntervalChange((sec) => set({ fetchIntervalSec: sec }))
    window.gbl.settings.onShortcutsDisabledChange((disabled) => set({ shortcutsDisabled: disabled }))
    window.gbl.settings.onGlobalShortcutChange(({ accelerator, registered }) =>
      set({ globalShortcut: accelerator, globalShortcutRegistered: registered }),
    )
    return snap.session
  },

  async setFetchInterval(sec) {
    const clamped = Math.max(0, Math.min(3600, Math.round(sec)))
    await window.gbl.settings.setFetchInterval(clamped)
    set({ fetchIntervalSec: clamped })
  },

  async setShortcutsDisabled(disabled) {
    await window.gbl.settings.setShortcutsDisabled(disabled)
    set({ shortcutsDisabled: disabled })
  },

  async setGlobalShortcut(accelerator) {
    const state = await window.gbl.settings.setGlobalShortcut(accelerator)
    set({ globalShortcut: state.accelerator, globalShortcutRegistered: state.registered })
    return state
  },
}))
