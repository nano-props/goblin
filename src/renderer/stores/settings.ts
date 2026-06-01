// Renderer-side mirror of the persistable settings (excluding theme,
// which has its own dedicated store because of the broadcast machinery
// around dark/light flips).
//
// Hydrate at boot pulls the persistable settings snapshot plus a
// separate external-app snapshot via IPC; setters write through to
// main, which broadcasts changes so any other window we eventually
// open stays in sync.

import { create } from 'zustand'
import type {
  EditorAppAvailability,
  EditorPref,
  ExternalAppsSnapshot,
  GlobalShortcutState,
  GitHubCliHostState,
  GitHubCliState,
  ResolvedEditorApp,
  ResolvedTerminalApp,
  SessionState,
  TerminalAppAvailability,
  TerminalPref,
} from '#/shared/rpc.ts'
import { getInitialBootstrap } from '#/renderer/bootstrap.ts'
import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/accelerator.ts'
import { DEFAULT_DETAIL_PANE_SIZES, DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { onRpcEventType, rpc } from '#/renderer/rpc.ts'

interface SettingsStore {
  fetchIntervalSec: number
  terminalNotificationsEnabled: boolean
  shortcutsDisabled: boolean
  globalShortcutDisabled: boolean
  swapCloseShortcuts: boolean
  toggleDetailOnActionBarBlankClick: boolean
  globalShortcut: string
  globalShortcutRegistered: boolean
  terminalApp: TerminalPref
  resolvedTerminalApp: ResolvedTerminalApp | null
  terminalAvailable: boolean
  terminalAppAvailability: TerminalAppAvailability
  editorApp: EditorPref
  resolvedEditorApp: ResolvedEditorApp | null
  editorAvailable: boolean
  editorAppAvailability: EditorAppAvailability
  externalAppsDetectedAt: number
  /** Saved session from previous run — consumed once by App.tsx during
   *  hydration, then irrelevant. We keep it in state for diagnostics. */
  savedSession: SessionState
  githubCliAvailable: boolean
  githubCliVersion: string | null
  githubCliHosts: Record<string, GitHubCliHostState>

  hydrate: () => Promise<SessionState>
  hydrateExternalApps: () => Promise<void>
  setFetchInterval: (sec: number) => Promise<void>
  setTerminalNotificationsEnabled: (enabled: boolean) => Promise<void>
  setShortcutsDisabled: (disabled: boolean) => Promise<void>
  setGlobalShortcutDisabled: (disabled: boolean) => Promise<void>
  setSwapCloseShortcuts: (swapped: boolean) => Promise<void>
  setToggleDetailOnActionBarBlankClick: (enabled: boolean) => Promise<void>
  setGlobalShortcut: (accelerator: string) => Promise<GlobalShortcutState>
  setTerminalApp: (pref: TerminalPref) => Promise<void>
  setEditorApp: (pref: EditorPref) => Promise<void>
  refreshGitHubCli: (hosts?: string[]) => Promise<void>
  refreshExternalApps: () => Promise<void>
}

type ExternalAppsStoreState = Pick<
  SettingsStore,
  | 'terminalApp'
  | 'resolvedTerminalApp'
  | 'terminalAvailable'
  | 'terminalAppAvailability'
  | 'editorApp'
  | 'resolvedEditorApp'
  | 'editorAvailable'
  | 'editorAppAvailability'
>

type TerminalAppStoreState = Pick<
  SettingsStore,
  'terminalApp' | 'resolvedTerminalApp' | 'terminalAvailable' | 'terminalAppAvailability'
>

type EditorAppStoreState = Pick<SettingsStore, 'editorApp' | 'resolvedEditorApp' | 'editorAvailable' | 'editorAppAvailability'>

let unsubscribers: Array<() => void> = []
let hydrateVersion = 0

function clearSettingsSubscriptions() {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
}

function clearSubscriptions(subscriptions: Array<() => void>): void {
  for (const unsubscribe of subscriptions) unsubscribe()
}

function sameTerminalAppAvailability(a: TerminalAppAvailability, b: TerminalAppAvailability): boolean {
  return a.ghostty === b.ghostty && a.terminal === b.terminal
}

function sameEditorAppAvailability(a: EditorAppAvailability, b: EditorAppAvailability): boolean {
  return a.vscode === b.vscode && a.cursor === b.cursor && a.windsurf === b.windsurf
}

function applyGitHubCliState(
  state: GitHubCliState,
): Pick<SettingsStore, 'githubCliAvailable' | 'githubCliVersion' | 'githubCliHosts'> {
  return {
    githubCliAvailable: state.available,
    githubCliVersion: state.version,
    githubCliHosts: state.hosts,
  }
}

function applyTerminalAppState(state: {
  pref: TerminalPref
  resolved: ResolvedTerminalApp | null
  available: boolean
  appAvailability: TerminalAppAvailability
}): TerminalAppStoreState {
  return {
    terminalApp: state.pref,
    resolvedTerminalApp: state.resolved,
    terminalAvailable: state.available,
    terminalAppAvailability: state.appAvailability,
  }
}

function applyEditorAppState(state: {
  pref: EditorPref
  resolved: ResolvedEditorApp | null
  available: boolean
  appAvailability: EditorAppAvailability
}): EditorAppStoreState {
  return {
    editorApp: state.pref,
    resolvedEditorApp: state.resolved,
    editorAvailable: state.available,
    editorAppAvailability: state.appAvailability,
  }
}

function applyExternalAppsSnapshot(state: ExternalAppsSnapshot): ExternalAppsStoreState {
  return {
    ...applyTerminalAppState(state.terminal),
    ...applyEditorAppState(state.editor),
  }
}

function sameTerminalAppState(s: SettingsStore, next: TerminalAppStoreState): boolean {
  return s.terminalApp === next.terminalApp &&
    s.resolvedTerminalApp === next.resolvedTerminalApp &&
    s.terminalAvailable === next.terminalAvailable &&
    sameTerminalAppAvailability(s.terminalAppAvailability, next.terminalAppAvailability)
}

function sameEditorAppState(s: SettingsStore, next: EditorAppStoreState): boolean {
  return s.editorApp === next.editorApp &&
    s.resolvedEditorApp === next.resolvedEditorApp &&
    s.editorAvailable === next.editorAvailable &&
    sameEditorAppAvailability(s.editorAppAvailability, next.editorAppAvailability)
}

function sameExternalAppsState(s: SettingsStore, next: ExternalAppsStoreState): boolean {
  return sameTerminalAppState(s, next) && sameEditorAppState(s, next)
}

function getExternalAppsDetectedAt(state: ExternalAppsSnapshot): number {
  return Math.max(state.terminal.detectedAt, state.editor.detectedAt)
}

function shouldIgnoreExternalAppsUpdate(currentDetectedAt: number, nextDetectedAt: number): boolean {
  return nextDetectedAt < currentDetectedAt
}

function mergeDetectedExternalAppsState<T extends object>(
  s: SettingsStore,
  next: T,
  detectedAt: number,
  same: (current: SettingsStore, candidate: T) => boolean,
): SettingsStore | (T & { externalAppsDetectedAt: number }) {
  if (shouldIgnoreExternalAppsUpdate(s.externalAppsDetectedAt, detectedAt)) return s
  return same(s, next) && s.externalAppsDetectedAt === detectedAt ? s : { ...next, externalAppsDetectedAt: detectedAt }
}

const initialSettings = getInitialBootstrap().initialSettings

export const useSettingsStore = create<SettingsStore>((set) => ({
  fetchIntervalSec: initialSettings?.fetchIntervalSec ?? 120,
  terminalNotificationsEnabled: initialSettings?.terminalNotificationsEnabled ?? false,
  shortcutsDisabled: initialSettings?.shortcutsDisabled ?? false,
  globalShortcutDisabled: initialSettings?.globalShortcutDisabled ?? false,
  swapCloseShortcuts: initialSettings?.swapCloseShortcuts ?? false,
  toggleDetailOnActionBarBlankClick: initialSettings?.toggleDetailOnActionBarBlankClick ?? false,
  globalShortcut: initialSettings?.globalShortcut ?? DEFAULT_GLOBAL_SHORTCUT,
  globalShortcutRegistered: initialSettings?.globalShortcutRegistered ?? false,
  terminalApp: initialSettings?.terminalApp ?? 'auto',
  editorApp: initialSettings?.editorApp ?? 'auto',
  resolvedTerminalApp: null,
  terminalAvailable: false,
  terminalAppAvailability: { ghostty: false, terminal: false },
  resolvedEditorApp: null,
  editorAvailable: false,
  editorAppAvailability: { vscode: false, cursor: false, windsurf: false },
  externalAppsDetectedAt: 0,
  savedSession: {
    openRepos: [],
    activeRepo: null,
    detailCollapsed: true,
    detailFocusMode: false,
    workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  },
  githubCliAvailable: false,
  githubCliVersion: null,
  githubCliHosts: {},

  async hydrate() {
    const version = ++hydrateVersion
    const snap = await rpc.settings.get.query()
    const githubCliSnap = await rpc.githubCli.get.query()
    if (version !== hydrateVersion) return snap.session
    set({
      fetchIntervalSec: snap.fetchIntervalSec,
      terminalNotificationsEnabled: snap.terminalNotificationsEnabled,
      shortcutsDisabled: snap.shortcutsDisabled,
      globalShortcutDisabled: snap.globalShortcutDisabled,
      swapCloseShortcuts: snap.swapCloseShortcuts,
      toggleDetailOnActionBarBlankClick: snap.toggleDetailOnActionBarBlankClick,
      globalShortcut: snap.globalShortcut,
      globalShortcutRegistered: snap.globalShortcutRegistered,
      terminalApp: snap.terminalApp,
      editorApp: snap.editorApp,
      savedSession: snap.session,
      ...applyGitHubCliState(githubCliSnap),
    })
    const nextUnsubscribers: Array<() => void> = []
    try {
      nextUnsubscribers.push(
        onRpcEventType('fetch-interval-changed', (event) => {
          set((s) => (s.fetchIntervalSec === event.sec ? s : { fetchIntervalSec: event.sec }))
        }),
        onRpcEventType('terminal-notifications-changed', (event) => {
          set((s) =>
            s.terminalNotificationsEnabled === event.enabled ? s : { terminalNotificationsEnabled: event.enabled },
          )
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
        onRpcEventType('toggle-detail-on-action-bar-blank-click-changed', (event) => {
          set((s) =>
            s.toggleDetailOnActionBarBlankClick === event.enabled
              ? s
              : { toggleDetailOnActionBarBlankClick: event.enabled },
          )
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
          set((s) => {
            return mergeDetectedExternalAppsState(s, applyTerminalAppState(event), event.detectedAt, sameTerminalAppState)
          })
        }),
        onRpcEventType('editor-app-changed', (event) => {
          set((s) => {
            return mergeDetectedExternalAppsState(s, applyEditorAppState(event), event.detectedAt, sameEditorAppState)
          })
        }),
        onRpcEventType('github-cli-changed', (event) => {
          set((s) => {
            const next = applyGitHubCliState(event.state)
            return s.githubCliAvailable === next.githubCliAvailable &&
                s.githubCliVersion === next.githubCliVersion &&
                s.githubCliHosts === next.githubCliHosts
              ? s
              : next
          })
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

  async hydrateExternalApps() {
    const state = await rpc.externalApps.get.query()
    const detectedAt = getExternalAppsDetectedAt(state)
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyExternalAppsSnapshot(state), detectedAt, sameExternalAppsState)
    })
  },

  async setFetchInterval(sec) {
    const clamped = Math.max(0, Math.min(3600, Math.round(sec)))
    await rpc.settings.setFetchInterval.mutate({ sec: clamped })
    set((s) => (s.fetchIntervalSec === clamped ? s : { fetchIntervalSec: clamped }))
  },

  async setTerminalNotificationsEnabled(enabled) {
    await rpc.settings.setTerminalNotificationsEnabled.mutate({ enabled })
    set((s) => (s.terminalNotificationsEnabled === enabled ? s : { terminalNotificationsEnabled: enabled }))
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

  async setToggleDetailOnActionBarBlankClick(enabled) {
    await rpc.settings.setToggleDetailOnActionBarBlankClick.mutate({ enabled })
    set((s) =>
      s.toggleDetailOnActionBarBlankClick === enabled ? s : { toggleDetailOnActionBarBlankClick: enabled },
    )
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
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyTerminalAppState(state), state.detectedAt, sameTerminalAppState)
    })
  },

  async setEditorApp(pref) {
    const state = await rpc.settings.setEditorApp.mutate({ pref })
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyEditorAppState(state), state.detectedAt, sameEditorAppState)
    })
  },

  async refreshGitHubCli(hosts) {
    const state = await rpc.githubCli.refresh.mutate(hosts && hosts.length > 0 ? { hosts } : undefined)
    set((s) => {
      const next = applyGitHubCliState(state)
      return s.githubCliAvailable === next.githubCliAvailable &&
          s.githubCliVersion === next.githubCliVersion &&
          s.githubCliHosts === next.githubCliHosts
        ? s
        : next
    })
  },

  async refreshExternalApps() {
    const state = await rpc.externalApps.refresh.mutate()
    const detectedAt = getExternalAppsDetectedAt(state)
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyExternalAppsSnapshot(state), detectedAt, sameExternalAppsState)
    })
  },
}))
