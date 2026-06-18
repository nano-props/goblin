import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { externalAppsQueryKey, settingsSnapshotQueryKey, useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import type {
  ExternalAppsSnapshot,
  RuntimeRecentReposState,
  RuntimeSettingsSnapshot,
  SettingsSnapshot,
} from '#/shared/api-types.ts'
import type { EditorPref, TerminalPref } from '#/shared/api-types.ts'
import {
  runtimeRecentReposStateFromSettingsSnapshot,
  runtimeSettingsSnapshotFromSettingsSnapshot,
} from '#/shared/settings-snapshot.ts'

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
  return {
    shortcutsDisabled: data?.shortcutsDisabled ?? false,
    swapCloseShortcuts: data?.swapCloseShortcuts ?? false,
    globalShortcutDisabled: data?.globalShortcutDisabled ?? false,
    globalShortcut: data?.globalShortcut ?? 'CommandOrControl+Shift+G',
    globalShortcutRegistered: data?.globalShortcutRegistered ?? false,
    toggleDetailOnActionBarBlankClick: data?.toggleDetailOnActionBarBlankClick ?? false,
  }
}

export function readRuntimeFetchSettings(data: RuntimeSettingsSnapshot | undefined) {
  return {
    fetchIntervalSec: data?.fetchIntervalSec ?? 120,
    terminalNotificationsEnabled: data?.terminalNotificationsEnabled ?? false,
  }
}

export function readRuntimeExternalAppSettings(data: ExternalAppsSnapshot | undefined) {
  return {
    terminalApp: data?.terminal.pref ?? ('auto' as TerminalPref),
    resolvedTerminalApp: data?.terminal.resolved ?? null,
    terminalAvailable: data?.terminal.available ?? false,
    terminalAppAvailability: data?.terminal.appAvailability ?? {
      ghostty: false,
      terminal: false,
      windowsTerminal: false,
    },
    editorApp: data?.editor.pref ?? ('auto' as EditorPref),
    resolvedEditorApp: data?.editor.resolved ?? null,
    editorAvailable: data?.editor.available ?? false,
    editorAppAvailability: data?.editor.appAvailability ?? { vscode: false, cursor: false, windsurf: false },
  }
}

export function readRuntimeGeneralSettings(data: RuntimeSettingsSnapshot | undefined) {
  return {
    toggleDetailOnActionBarBlankClick: data?.toggleDetailOnActionBarBlankClick ?? false,
  }
}

export function readRuntimeLanSettings(data: RuntimeSettingsSnapshot | undefined) {
  return {
    lanEnabled: data?.lanEnabled ?? false,
  }
}

export function getRuntimeRecentRepos() {
  return currentRuntimeRecentReposState()?.recentRepos ?? []
}

export function useRuntimeRecentRepos() {
  return useRuntimeRecentReposState()?.recentRepos ?? []
}
