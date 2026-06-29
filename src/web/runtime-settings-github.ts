import { refreshGitHubCliDetection } from '#/web/settings-actions.ts'
import { useSettingsMutation } from '#/web/settings-mutations.ts'

export function useGitHubSettingsController() {
  const refreshMutation = useSettingsMutation('GitHub CLI refresh', async () => {
    await refreshGitHubCliDetection()
  })
  return {
    refreshingGitHubCli: refreshMutation.isPending,
    async refreshGitHubCli(): Promise<void> {
      await refreshMutation.mutateAsync(undefined)
    },
  }
}
