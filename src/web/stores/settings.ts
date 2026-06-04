// Renderer-side mirror of the persistable settings (excluding theme,
// which has its own dedicated store because of the broadcast machinery
// around dark/light flips).
//
// Hydrate at boot pulls the persistable settings snapshot plus a
// separate external-app snapshot from the embedded server; setters write
// back through the server contract. Cross-window coherence comes from
// server invalidation + refetch, not from a main-owned settings runtime.

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
  SettingsSnapshot,
  TerminalAppAvailability,
  TerminalPref,
} from '#/shared/rpc.ts'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import {
  getExternalAppsSnapshot,
  getGitHubCliState,
  getSettingsSnapshot,
  saveSession,
  setSettingsFetchInterval,
  setGlobalShortcut,
  setGlobalShortcutDisabled,
  setPreferredEditorApp,
  setPreferredTerminalApp,
  setShortcutsDisabled,
  setSwapCloseShortcuts,
  setTerminalNotificationsEnabled,
  setToggleDetailOnActionBarBlankClick,
  refreshExternalAppsSnapshot,
  refreshGitHubCliState,
} from '#/web/app-data-client.ts'
import { DEFAULT_GLOBAL_SHORTCUT } from '#/shared/accelerator.ts'
import { DEFAULT_DETAIL_PANE_SIZES, DEFAULT_WORKSPACE_LAYOUT } from '#/shared/workspace-layout.ts'
import { subscribeSettingsRefetch } from '#/web/settings-sync-subscription.ts'

export const EMPTY_SESSION_STATE: SessionState = {
  openRepos: [],
  activeRepo: null,
  detailCollapsed: true,
  detailFocusMode: false,
  workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
  detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  selectedTerminalByWorktree: {},
}

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
  /** Session snapshot from the previous run — consumed once during
   *  bootstrap, then cleared so it does not masquerade as live state or
   *  imply runtime two-way sync with the repos store. */
  bootSessionSnapshot: SessionState | null
  githubCliAvailable: boolean
  githubCliVersion: string | null
  githubCliHosts: Record<string, GitHubCliHostState>

  /** Fetches the latest persisted settings snapshot plus the boot-only
   *  session snapshot; this is not a long-lived session mirror. */
  hydrate: () => Promise<SessionState>
  /** Returns the boot session snapshot once, then clears it so all later
   *  session writes remain renderer -> persistence only. */
  consumeBootSessionSnapshot: () => SessionState
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

type EditorAppStoreState = Pick<
  SettingsStore,
  'editorApp' | 'resolvedEditorApp' | 'editorAvailable' | 'editorAppAvailability'
>

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

type SettingsSnapshotStoreState = Pick<
  SettingsStore,
  | 'fetchIntervalSec'
  | 'terminalNotificationsEnabled'
  | 'shortcutsDisabled'
  | 'globalShortcutDisabled'
  | 'swapCloseShortcuts'
  | 'toggleDetailOnActionBarBlankClick'
  | 'globalShortcut'
  | 'globalShortcutRegistered'
  | 'terminalApp'
  | 'editorApp'
>

function applySettingsSnapshotState(snapshot: SettingsSnapshot): SettingsSnapshotStoreState {
  return {
    fetchIntervalSec: snapshot.fetchIntervalSec,
    terminalNotificationsEnabled: snapshot.terminalNotificationsEnabled,
    shortcutsDisabled: snapshot.shortcutsDisabled,
    globalShortcutDisabled: snapshot.globalShortcutDisabled,
    swapCloseShortcuts: snapshot.swapCloseShortcuts,
    toggleDetailOnActionBarBlankClick: snapshot.toggleDetailOnActionBarBlankClick,
    globalShortcut: snapshot.globalShortcut,
    globalShortcutRegistered: snapshot.globalShortcutRegistered,
    terminalApp: snapshot.terminalApp,
    editorApp: snapshot.editorApp,
  }
}

function sameSettingsSnapshotState(s: SettingsStore, next: SettingsSnapshotStoreState): boolean {
  return (
    s.fetchIntervalSec === next.fetchIntervalSec &&
    s.terminalNotificationsEnabled === next.terminalNotificationsEnabled &&
    s.shortcutsDisabled === next.shortcutsDisabled &&
    s.globalShortcutDisabled === next.globalShortcutDisabled &&
    s.swapCloseShortcuts === next.swapCloseShortcuts &&
    s.toggleDetailOnActionBarBlankClick === next.toggleDetailOnActionBarBlankClick &&
    s.globalShortcut === next.globalShortcut &&
    s.globalShortcutRegistered === next.globalShortcutRegistered &&
    s.terminalApp === next.terminalApp &&
    s.editorApp === next.editorApp
  )
}

function sameTerminalAppState(s: SettingsStore, next: TerminalAppStoreState): boolean {
  return (
    s.terminalApp === next.terminalApp &&
    s.resolvedTerminalApp === next.resolvedTerminalApp &&
    s.terminalAvailable === next.terminalAvailable &&
    sameTerminalAppAvailability(s.terminalAppAvailability, next.terminalAppAvailability)
  )
}

function sameEditorAppState(s: SettingsStore, next: EditorAppStoreState): boolean {
  return (
    s.editorApp === next.editorApp &&
    s.resolvedEditorApp === next.resolvedEditorApp &&
    s.editorAvailable === next.editorAvailable &&
    sameEditorAppAvailability(s.editorAppAvailability, next.editorAppAvailability)
  )
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

export const useSettingsStore = create<SettingsStore>((set, get) => ({
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
  bootSessionSnapshot: null,
  githubCliAvailable: false,
  githubCliVersion: null,
  githubCliHosts: {},

  async hydrate() {
    const version = ++hydrateVersion
    const snap = await getSettingsSnapshot()
    const githubCliSnap = await getGitHubCliState()
    if (version !== hydrateVersion) return snap.session
    set({
      ...applySettingsSnapshotState(snap),
      bootSessionSnapshot: snap.session,
      ...applyGitHubCliState(githubCliSnap),
    })
    const nextUnsubscribers: Array<() => void> = []
    nextUnsubscribers.push(
      subscribeSettingsRefetch({
        scope: 'settings-snapshot',
        fetch: getSettingsSnapshot,
        label: 'settings',
        apply: (next) => {
          set((s) => {
            const candidate = applySettingsSnapshotState(next)
            return sameSettingsSnapshotState(s, candidate) ? s : candidate
          })
        },
      }),
      subscribeSettingsRefetch({
        scope: 'external-apps',
        fetch: getExternalAppsSnapshot,
        label: 'settings external apps',
        apply: (state) => {
          const detectedAt = getExternalAppsDetectedAt(state)
          set((s) =>
            mergeDetectedExternalAppsState(s, applyExternalAppsSnapshot(state), detectedAt, sameExternalAppsState),
          )
        },
      }),
    )
    if (version !== hydrateVersion) {
      clearSubscriptions(nextUnsubscribers)
      return snap.session
    }
    clearSettingsSubscriptions()
    unsubscribers = nextUnsubscribers
    return snap.session
  },

  consumeBootSessionSnapshot(): SessionState {
    const snapshot: SessionState = get().bootSessionSnapshot ?? EMPTY_SESSION_STATE
    set((s) => (s.bootSessionSnapshot === null ? s : { bootSessionSnapshot: null }))
    return snapshot
  },

  async hydrateExternalApps() {
    const state = await getExternalAppsSnapshot()
    const detectedAt = getExternalAppsDetectedAt(state)
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyExternalAppsSnapshot(state), detectedAt, sameExternalAppsState)
    })
  },

  async setFetchInterval(sec) {
    const clamped = Math.max(0, Math.min(3600, Math.round(sec)))
    await setSettingsFetchInterval(clamped)
    set((s) => (s.fetchIntervalSec === clamped ? s : { fetchIntervalSec: clamped }))
  },

  async setTerminalNotificationsEnabled(enabled) {
    await setTerminalNotificationsEnabled(enabled)
    set((s) => (s.terminalNotificationsEnabled === enabled ? s : { terminalNotificationsEnabled: enabled }))
  },

  async setShortcutsDisabled(disabled) {
    await setShortcutsDisabled(disabled)
    set((s) => (s.shortcutsDisabled === disabled ? s : { shortcutsDisabled: disabled }))
  },

  async setGlobalShortcutDisabled(disabled) {
    await setGlobalShortcutDisabled(disabled)
    set((s) => (s.globalShortcutDisabled === disabled ? s : { globalShortcutDisabled: disabled }))
  },

  async setSwapCloseShortcuts(swapped) {
    await setSwapCloseShortcuts(swapped)
    set((s) => (s.swapCloseShortcuts === swapped ? s : { swapCloseShortcuts: swapped }))
  },

  async setToggleDetailOnActionBarBlankClick(enabled) {
    await setToggleDetailOnActionBarBlankClick(enabled)
    set((s) => (s.toggleDetailOnActionBarBlankClick === enabled ? s : { toggleDetailOnActionBarBlankClick: enabled }))
  },

  async setGlobalShortcut(accelerator) {
    const state = await setGlobalShortcut(accelerator)
    set((s) =>
      s.globalShortcut === state.accelerator && s.globalShortcutRegistered === state.registered
        ? s
        : { globalShortcut: state.accelerator, globalShortcutRegistered: state.registered },
    )
    return state
  },

  async setTerminalApp(pref) {
    const state = await setPreferredTerminalApp(pref)
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyTerminalAppState(state), state.detectedAt, sameTerminalAppState)
    })
  },

  async setEditorApp(pref) {
    const state = await setPreferredEditorApp(pref)
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyEditorAppState(state), state.detectedAt, sameEditorAppState)
    })
  },

  async refreshGitHubCli(hosts) {
    const state = await refreshGitHubCliState(hosts)
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
    const state = await refreshExternalAppsSnapshot()
    const detectedAt = getExternalAppsDetectedAt(state)
    set((s) => {
      return mergeDetectedExternalAppsState(s, applyExternalAppsSnapshot(state), detectedAt, sameExternalAppsState)
    })
  },
}))
