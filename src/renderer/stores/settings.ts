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
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'

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

let unsubscribers: Array<() => void> = []
let hydrateVersion = 0

function clearSettingsSubscriptions() {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
}

function clearSubscriptions(subscriptions: Array<() => void>): void {
  for (const unsubscribe of subscriptions) unsubscribe()
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  fetchIntervalSec: 60,
  shortcutsDisabled: false,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutRegistered: false,
  savedSession: { openRepos: [], activeRepo: null, detailCollapsed: true },

  async hydrate() {
    const version = ++hydrateVersion
    const snap = await rpc.settings.get.query()
    if (version !== hydrateVersion) return snap.session
    set({
      fetchIntervalSec: snap.fetchIntervalSec,
      shortcutsDisabled: snap.shortcutsDisabled,
      globalShortcut: snap.globalShortcut,
      globalShortcutRegistered: snap.globalShortcutRegistered,
      savedSession: snap.session,
    })
    const nextUnsubscribers: Array<() => void> = []
    try {
      nextUnsubscribers.push(
        onRpcEventType('fetch-interval-changed', (event) => {
          set((s) => (s.fetchIntervalSec === event.sec ? s : { fetchIntervalSec: event.sec }))
        }),
        onRpcEventType('shortcuts-disabled-changed', (event) => {
          set((s) => (s.shortcutsDisabled === event.disabled ? s : { shortcutsDisabled: event.disabled }))
        }),
        onRpcEventType('global-shortcut-changed', (event) => {
          const { accelerator, registered } = event.state
          set((s) =>
            s.globalShortcut === accelerator && s.globalShortcutRegistered === registered
              ? s
              : { globalShortcut: accelerator, globalShortcutRegistered: registered },
          )
        }),
      )
    } catch (err) {
      clearSubscriptions(nextUnsubscribers)
      throw err
    }
    if (version !== hydrateVersion) {
      clearSubscriptions(nextUnsubscribers)
      return snap.session
    }
    clearSettingsSubscriptions()
    unsubscribers = nextUnsubscribers
    return snap.session
  },

  async setFetchInterval(sec) {
    const clamped = Math.max(0, Math.min(3600, Math.round(sec)))
    await rpc.settings.setFetchInterval.mutate({ sec: clamped })
    set((s) => (s.fetchIntervalSec === clamped ? s : { fetchIntervalSec: clamped }))
  },

  async setShortcutsDisabled(disabled) {
    await rpc.settings.setShortcutsDisabled.mutate({ disabled })
    set((s) => (s.shortcutsDisabled === disabled ? s : { shortcutsDisabled: disabled }))
  },

  async setGlobalShortcut(accelerator) {
    const state = await rpc.settings.setGlobalShortcut.mutate({ accelerator })
    set((s) =>
      s.globalShortcut === state.accelerator && s.globalShortcutRegistered === state.registered
        ? s
        : { globalShortcut: state.accelerator, globalShortcutRegistered: state.registered },
    )
    return state
  },
}))
