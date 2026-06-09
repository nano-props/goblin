import { useExternalAppsQuery, useRefreshExternalAppsMutation, useSetEditorAppMutation, useSetTerminalAppMutation } from '#/web/settings-queries.ts'
import { readRuntimeExternalAppSettings } from '#/web/runtime-settings-snapshot.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'
import type { EditorAppState, TerminalAppState } from '#/shared/rpc.ts'
import type { EditorPref, TerminalPref } from '#/shared/rpc.ts'

export function useRuntimeExternalAppSettings() {
  const { data } = useExternalAppsQuery()
  return readRuntimeExternalAppSettings(data)
}

export function useExternalAppSettingsController() {
  const refreshExternalApps = useRefreshExternalAppsMutation()
  const setTerminalApp = useSetTerminalAppMutation()
  const setEditorApp = useSetEditorAppMutation()
  return {
    refreshing: refreshExternalApps.isPending,
    async setTerminalApp(pref: TerminalPref): Promise<TerminalAppState | null> {
      return await runSettingsControllerAction('terminal update', async () => await setTerminalApp.mutateAsync(pref))
    },
    async setEditorApp(pref: EditorPref): Promise<EditorAppState | null> {
      return await runSettingsControllerAction('editor update', async () => await setEditorApp.mutateAsync(pref))
    },
    async refreshExternalApps(): Promise<void> {
      await runSettingsControllerAction('external app refresh', async () => {
        await refreshExternalApps.mutateAsync()
      })
    },
  }
}
