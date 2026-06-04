import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import {
  externalAppsQueryKey,
  settingsSnapshotQueryKey,
  useExternalAppsQuery,
  useSettingsSnapshotQuery,
} from '#/web/settings-queries.ts'
import type { ExternalAppsSnapshot, SettingsSnapshot } from '#/shared/rpc.ts'
import type { EditorPref, TerminalPref } from '#/shared/rpc.ts'

function fallbackInitialSettings() {
  return getInitialBootstrap().initialSettings
}

function currentSettingsSnapshot(): SettingsSnapshot | undefined {
  return mainWindowQueryClient.getQueryData<SettingsSnapshot>(settingsSnapshotQueryKey())
}

function currentExternalAppsSnapshot(): ExternalAppsSnapshot | undefined {
  return mainWindowQueryClient.getQueryData<ExternalAppsSnapshot>(externalAppsQueryKey())
}

function readRuntimeShortcutSettings(data: SettingsSnapshot | undefined) {
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

function readRuntimeFetchSettings(data: SettingsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    fetchIntervalSec: data?.fetchIntervalSec ?? fallback?.fetchIntervalSec ?? 120,
    terminalNotificationsEnabled: data?.terminalNotificationsEnabled ?? fallback?.terminalNotificationsEnabled ?? false,
  }
}

function readRuntimeExternalAppSettings(data: ExternalAppsSnapshot | undefined) {
  const fallback = fallbackInitialSettings()
  return {
    terminalApp: data?.terminal.pref ?? fallback?.terminalApp ?? ('auto' as TerminalPref),
    resolvedTerminalApp: data?.terminal.resolved ?? null,
    terminalAvailable: data?.terminal.available ?? false,
    terminalAppAvailability: data?.terminal.appAvailability ?? { ghostty: false, terminal: false },
    editorApp: data?.editor.pref ?? fallback?.editorApp ?? ('auto' as EditorPref),
    resolvedEditorApp: data?.editor.resolved ?? null,
    editorAvailable: data?.editor.available ?? false,
    editorAppAvailability: data?.editor.appAvailability ?? { vscode: false, cursor: false, windsurf: false },
  }
}

export function getRuntimeShortcutSettings() {
  return readRuntimeShortcutSettings(currentSettingsSnapshot())
}

export function useRuntimeShortcutSettings() {
  const { data } = useSettingsSnapshotQuery()
  return readRuntimeShortcutSettings(data)
}

export function getRuntimeFetchSettings() {
  return readRuntimeFetchSettings(currentSettingsSnapshot())
}

export function useRuntimeFetchSettings() {
  const { data } = useSettingsSnapshotQuery()
  return readRuntimeFetchSettings(data)
}

export function getRuntimeExternalAppSettings() {
  return readRuntimeExternalAppSettings(currentExternalAppsSnapshot())
}

export function useRuntimeExternalAppSettings() {
  const { data } = useExternalAppsQuery()
  return readRuntimeExternalAppSettings(data)
}
