// Renderer-side mirror of the persistable settings (excluding theme,
// which has its own dedicated store because of the broadcast machinery
// around dark/light flips).
//
// Hydrate at boot pulls the full snapshot via IPC; setters write
// through to main, which broadcasts changes so any other window we
// eventually open stays in sync.

import { create } from 'zustand'
import type {
  EditorPref,
  GlobalShortcutState,
  ResolvedEditorApp,
  ResolvedTerminalApp,
  SessionState,
  TerminalPref,
} from '#/shared/rpc.ts'
import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/accelerator.ts'
import { DEFAULT_DETAIL_PANE_SIZES, DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'

interface SettingsStore {
  fetchIntervalSec: number
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  globalShortcut: string
  globalShortcutRegistered: boolean
  terminalApp: TerminalPref
  resolvedTerminalApp: ResolvedTerminalApp | null
  terminalAvailable: boolean
  editorApp: EditorPref
  resolvedEditorApp: ResolvedEditorApp | null
  editorAvailable: boolean
  /** Saved session from previous run — consumed once by App.tsx during
   *  hydration, then irrelevant. We keep it in state for diagnostics. */
  savedSession: SessionState

  hydrate: () => Promise<SessionState>
  setFetchInterval: (sec: number) => Promise<void>
  setShortcutsDisabled: (disabled: boolean) => Promise<void>
  setGlobalShortcutDisabled: (disabled: boolean) => Promise<void>
  setSwapCloseShortcuts: (swapped: boolean) => Promise<void>
  setGlobalShortcut: (accelerator: string) => Promise<GlobalShortcutState>
  setTerminalApp: (pref: TerminalPref) => Promise<void>
  setEditorApp: (pref: EditorPref) => Promise<void>
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
  fetchIntervalSec: 120,
  shortcutsDisabled: false,
  globalShortcutDisabled: false,
  swapCloseShortcuts: false,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutRegistered: false,
  terminalApp: 'auto',
  resolvedTerminalApp: null,
  terminalAvailable: true,
  editorApp: 'auto',
  resolvedEditorApp: null,
  editorAvailable: false,
  savedSession: {
    openRepos: [],
    activeRepo: null,
    detailCollapsed: true,
    detailFocusMode: false,
    workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  },

  async hydrate() {
    const version = ++hydrateVersion
    const snap = await rpc.settings.get.query()
    if (version !== hydrateVersion) return snap.session
    set({
      fetchIntervalSec: snap.fetchIntervalSec,
      shortcutsDisabled: snap.shortcutsDisabled,
      globalShortcutDisabled: snap.globalShortcutDisabled,
      swapCloseShortcuts: snap.swapCloseShortcuts,
      globalShortcut: snap.globalShortcut,
      globalShortcutRegistered: snap.globalShortcutRegistered,
      terminalApp: snap.terminalApp,
      resolvedTerminalApp: snap.resolvedTerminalApp,
      terminalAvailable: snap.terminalAvailable,
      editorApp: snap.editorApp,
      resolvedEditorApp: snap.resolvedEditorApp,
      editorAvailable: snap.editorAvailable,
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
        onRpcEventType('global-shortcut-disabled-changed', (event) => {
          set((s) => (s.globalShortcutDisabled === event.disabled ? s : { globalShortcutDisabled: event.disabled }))
        }),
        onRpcEventType('swap-close-shortcuts-changed', (event) => {
          set((s) => (s.swapCloseShortcuts === event.swapped ? s : { swapCloseShortcuts: event.swapped }))
        }),
        onRpcEventType('global-shortcut-changed', (event) => {
          const { accelerator, registered } = event.state
          set((s) =>
            s.globalShortcut === accelerator && s.globalShortcutRegistered === registered
              ? s
              : { globalShortcut: accelerator, globalShortcutRegistered: registered },
          )
        }),
        onRpcEventType('terminal-app-changed', (event) => {
          set((s) =>
            s.terminalApp === event.pref &&
            s.resolvedTerminalApp === event.resolved &&
            s.terminalAvailable === event.available
              ? s
              : { terminalApp: event.pref, resolvedTerminalApp: event.resolved, terminalAvailable: event.available },
          )
        }),
        onRpcEventType('editor-app-changed', (event) => {
          set((s) =>
            s.editorApp === event.pref &&
            s.resolvedEditorApp === event.resolved &&
            s.editorAvailable === event.available
              ? s
              : { editorApp: event.pref, resolvedEditorApp: event.resolved, editorAvailable: event.available },
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

  async setGlobalShortcutDisabled(disabled) {
    await rpc.settings.setGlobalShortcutDisabled.mutate({ disabled })
    set((s) => (s.globalShortcutDisabled === disabled ? s : { globalShortcutDisabled: disabled }))
  },

  async setSwapCloseShortcuts(swapped) {
    await rpc.settings.setSwapCloseShortcuts.mutate({ swapped })
    set((s) => (s.swapCloseShortcuts === swapped ? s : { swapCloseShortcuts: swapped }))
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

  async setTerminalApp(pref) {
    const state = await rpc.settings.setTerminalApp.mutate({ pref })
    set((s) =>
      s.terminalApp === state.pref &&
      s.resolvedTerminalApp === state.resolved &&
      s.terminalAvailable === state.available
        ? s
        : { terminalApp: state.pref, resolvedTerminalApp: state.resolved, terminalAvailable: state.available },
    )
  },

  async setEditorApp(pref) {
    const state = await rpc.settings.setEditorApp.mutate({ pref })
    set((s) =>
      s.editorApp === state.pref && s.resolvedEditorApp === state.resolved && s.editorAvailable === state.available
        ? s
        : { editorApp: state.pref, resolvedEditorApp: state.resolved, editorAvailable: state.available },
    )
  },
}))
