import { useExternalAppsQuery } from '#/web/settings-queries.ts'
import { readRuntimeExternalAppSettings } from '#/web/runtime-settings-snapshot.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'
import { refreshExternalAppsDetection, setEditorAppPreference, setTerminalAppPreference } from '#/web/settings-write-paths.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'
import type { EditorAppState, TerminalAppState } from '#/shared/rpc.ts'
import type { EditorPref, TerminalPref } from '#/shared/rpc.ts'

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
