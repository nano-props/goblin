import { useExternalAppsQuery } from '#/web/settings-queries.ts'
import { readRuntimeExternalAppSettings } from '#/web/settings-read-projection.ts'
import { runSettingsAction, refreshExternalAppsDetection } from '#/web/settings-actions.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'

export function useExternalAppSettings() {
  const { data } = useExternalAppsQuery()
  return readRuntimeExternalAppSettings(data)
}

export function useExternalAppSettingsController() {
  const { isPending: refreshing, run } = useAsyncPending<'refresh'>()
  return {
    refreshing,
    async refreshExternalApps(): Promise<void> {
      await run('refresh', async () => {
        await runSettingsAction('external app refresh', async () => {
          await refreshExternalAppsDetection()
        })
      })
    },
  }
}
