import { useExternalAppsQuery } from '#/web/settings-queries.ts'
import { readRuntimeExternalAppSettings } from '#/web/settings-read-projection.ts'
import { refreshExternalAppsDetection } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'

export function useExternalAppSettings() {
  const { data } = useExternalAppsQuery()
  return readRuntimeExternalAppSettings(data)
}

export function useExternalAppSettingsController() {
  const refreshMutation = useSettingsMutation('external app refresh', async () => {
    await refreshExternalAppsDetection()
  })
  return {
    refreshing: refreshMutation.isPending,
    async refreshExternalApps(): Promise<void> {
      await refreshMutation.mutateAsync(undefined)
    },
  }
}
