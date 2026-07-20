import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import type { ExternalAppsSnapshot, RuntimeSettingsSnapshot, SettingsSnapshot } from '#/shared/api-types.ts'
import { runtimeSettingsSnapshotFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'

function currentSettingsSnapshot(): SettingsSnapshot | undefined {
  return primaryWindowQueryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey())
}

function runtimeSettingsSnapshotOrUndefined(
  snapshot: SettingsSnapshot | undefined,
): RuntimeSettingsSnapshot | undefined {
  return snapshot ? runtimeSettingsSnapshotFromSettingsSnapshot(snapshot) : undefined
}

export function currentRuntimeSettingsSnapshot(): RuntimeSettingsSnapshot | undefined {
  return runtimeSettingsSnapshotOrUndefined(currentSettingsSnapshot())
}

export function useRuntimeSettingsSnapshot(): RuntimeSettingsSnapshot | undefined {
  const { data } = useSettingsSnapshotQuery()
  return runtimeSettingsSnapshotOrUndefined(data)
}

export function readRuntimeShortcutSettings(data: RuntimeSettingsSnapshot | undefined) {
  return {
    shortcutsDisabled: data?.shortcutsDisabled ?? false,
    globalShortcutDisabled: data?.globalShortcutDisabled ?? false,
    globalShortcut: data?.globalShortcut ?? 'CommandOrControl+Shift+G',
    globalShortcutRegistered: data?.globalShortcutRegistered ?? false,
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
    terminalAvailable: data?.terminal.available ?? false,
    terminalAppAvailability: data?.terminal.appAvailability ?? {
      ghostty: false,
      terminal: false,
      windowsTerminal: false,
    },
    editorAvailable: data?.editor.available ?? false,
    editorAppAvailability: data?.editor.appAvailability ?? { vscode: false },
  }
}

export function readRuntimeLanSettings(data: RuntimeSettingsSnapshot | undefined) {
  return {
    lanEnabled: data?.lanEnabled ?? false,
  }
}

export function useRuntimeRecentWorkspaces() {
  const { data } = useSettingsSnapshotQuery()
  return data?.recentWorkspaces ?? []
}
