import { refreshGitHubCliDetection } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'

export function useGitHubSettingsController() {
  const refreshMutation = useSettingsMutation(
    'GitHub CLI refresh',
    async () => {
      await refreshGitHubCliDetection()
    },
    { singleFlight: true },
  )
  return {
    refreshingGitHubCli: refreshMutation.isPending,
    refreshGitHubCli(): void {
      refreshMutation.mutate(undefined)
    },
  }
}
