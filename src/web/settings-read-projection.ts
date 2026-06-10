import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey, useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import type { ExternalAppsSnapshot, RuntimeRecentReposState, RuntimeSettingsSnapshot, SettingsSnapshot } from '#/shared/rpc.ts'
import type { EditorPref, TerminalPref } from '#/shared/rpc.ts'
import { runtimeRecentReposStateFromSettingsSnapshot, runtimeSettingsSnapshotFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'

export function fallbackInitialSettings() {
  return getInitialBootstrap().initialSettings
}

export function currentSettingsSnapshot(): SettingsSnapshot | undefined {
  return mainWindowQueryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey())
}

export function runtimeSettingsSnapshotOrUndefined(
  snapshot: SettingsSnapshot | undefined,
): RuntimeSettingsSnapshot | undefined {
  return snapshot ? runtimeSettingsSnapshotFromSettingsSnapshot(snapshot) : undefined
}

export function currentRuntimeSettingsSnapshot(): RuntimeSettingsSnapshot | undefined {
  return runtimeSettingsSnapshotOrUndefined(currentSettingsSnapshot())
}

export function runtimeRecentReposStateOrUndefined(
  snapshot: SettingsSnapshot | undefined,
): RuntimeRecentReposState | undefined {
  return snapshot ? runtimeRecentReposStateFromSettingsSnapshot(snapshot) : undefined
}

export function currentRuntimeRecentReposState(): RuntimeRecentReposState | undefined {
  return runtimeRecentReposStateOrUndefined(currentSettingsSnapshot())
}

export function useRuntimeSettingsSnapshot(): RuntimeSettingsSnapshot | undefined {
  const { data } = useSettingsSnapshotQuery()
  return runtimeSettingsSnapshotOrUndefined(data)
}

export function useRuntimeRecentReposState(): RuntimeRecentReposState | undefined {
  const { data } = useSettingsSnapshotQuery()
  return runtimeRecentReposStateOrUndefined(data)
}

export function currentExternalAppsSnapshot(): ExternalAppsSnapshot | undefined {
  return mainWindowQueryClient.getQueryData<ExternalAppsSnapshot>(externalAppsQueryKey())
}

export function readRuntimeShortcutSettings(data: RuntimeSettingsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    shortcutsDisabled: data?.shortcutsDisabled ?? fallback?.shortcutsDisabled ?? false,
    swapCloseShortcuts: data?.swapCloseShortcuts ?? fallback?.swapCloseShortcuts ?? false,
    globalShortcutDisabled: data?.globalShortcutDisabled ?? fallback?.globalShortcutDisabled ?? false,
    globalShortcut: data?.globalShortcut ?? fallback?.globalShortcut ?? 'CommandOrControl+Shift+G',
    globalShortcutRegistered: data?.globalShortcutRegistered ?? fallback?.globalShortcutRegistered ?? false,
    toggleDetailOnActionBarBlankClick:
      data?.toggleDetailOnActionBarBlankClick ?? fallback?.toggleDetailOnActionBarBlankClick ?? false,
  }
}

export function readRuntimeFetchSettings(data: RuntimeSettingsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    fetchIntervalSec: data?.fetchIntervalSec ?? fallback?.fetchIntervalSec ?? 120,
    terminalNotificationsEnabled: data?.terminalNotificationsEnabled ?? fallback?.terminalNotificationsEnabled ?? false,
  }
}

export function readRuntimeExternalAppSettings(data: ExternalAppsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    terminalApp: data?.terminal.pref ?? fallback?.terminalApp ?? ('auto' as TerminalPref),
    resolvedTerminalApp: data?.terminal.resolved ?? null,
    terminalAvailable: data?.terminal.available ?? false,
    terminalAppAvailability: data?.terminal.appAvailability ?? { ghostty: false, terminal: false, windowsTerminal: false },
    editorApp: data?.editor.pref ?? fallback?.editorApp ?? ('auto' as EditorPref),
    resolvedEditorApp: data?.editor.resolved ?? null,
    editorAvailable: data?.editor.available ?? false,
    editorAppAvailability: data?.editor.appAvailability ?? { vscode: false, cursor: false, windsurf: false },
  }
}

export function readRuntimeGeneralSettings(data: RuntimeSettingsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    toggleDetailOnActionBarBlankClick:
      data?.toggleDetailOnActionBarBlankClick ?? fallback?.toggleDetailOnActionBarBlankClick ?? false,
  }
}

export function readRuntimeLanSettings(data: RuntimeSettingsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    lanEnabled: data?.lanEnabled ?? fallback?.lanEnabled ?? false,
  }
}

export function getRuntimeRecentRepos() {
  return currentRuntimeRecentReposState()?.recentRepos ?? []
}

export function useRuntimeRecentRepos() {
  return useRuntimeRecentReposState()?.recentRepos ?? []
}
