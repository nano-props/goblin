import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { appQueryClient } from '#/web/app-query-client.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import type { ExternalAppsSnapshot, RuntimeSettingsSnapshot, SettingsSnapshot } from '#/shared/api-types.ts'
import { runtimeSettingsSnapshotFromSettingsSnapshot } from '#/shared/settings-snapshot.ts'

function currentSettingsSnapshot(): SettingsSnapshot | undefined {
  return appQueryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey())
}

function runtimeSettingsSnapshotOrUndefined(
  snapshot: SettingsSnapshot | undefined,
): RuntimeSettingsSnapshot | undefined {
  return snapshot ? runtimeSettingsSnapshotFromSettingsSnapshot(snapshot) : undefined
}

export function currentRuntimeSettingsSnapshot(): RuntimeSettingsSnapshot | undefined {
  return runtimeSettingsSnapshotOrUndefined(currentSettingsSnapshot())
}

export function useRuntimeSettingsSnapshot(): ComputedRef<RuntimeSettingsSnapshot | undefined> {
  const { data } = useSettingsSnapshotQuery()
  return computed(() => runtimeSettingsSnapshotOrUndefined(data.value))
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

export function useRuntimeRecentWorkspaces(): ComputedRef<SettingsSnapshot['recentWorkspaces']> {
  const { data } = useSettingsSnapshotQuery()
  return computed(() => data.value?.recentWorkspaces ?? [])
}
