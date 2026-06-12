import { useExternalAppsQuery } from '#/web/settings-queries.ts'
import { readRuntimeExternalAppSettings } from '#/web/settings-read-projection.ts'
import { runSettingsControllerAction } from '#/web/settings-write-paths.ts'
import {
  refreshExternalAppsDetection,
  setEditorAppPreference,
  setTerminalAppPreference,
} from '#/web/settings-write-paths.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import type { EditorAppState, TerminalAppState } from '#/shared/api-types.ts'
import type { EditorPref, TerminalPref } from '#/shared/api-types.ts'

export function useRuntimeExternalAppSettings() {
  const { data } = useExternalAppsQuery()
  return readRuntimeExternalAppSettings(data)
}

export function useExternalAppSettingsController() {
  const { isPending: refreshing, run } = useAsyncPending<'refresh'>()
  return {
    refreshing,
    async setTerminalApp(pref: TerminalPref): Promise<TerminalAppState | null> {
      return await runSettingsControllerAction('terminal update', async () => await setTerminalAppPreference(pref))
    },
    async setEditorApp(pref: EditorPref): Promise<EditorAppState | null> {
      return await runSettingsControllerAction('editor update', async () => await setEditorAppPreference(pref))
    },
    async refreshExternalApps(): Promise<void> {
      await run('refresh', async () => {
        await runSettingsControllerAction('external app refresh', async () => {
          await refreshExternalAppsDetection()
        })
      })
    },
  }
}
