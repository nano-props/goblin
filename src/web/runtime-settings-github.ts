import { useRefreshGitHubCliMutation } from '#/web/settings-queries.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'

export function useGitHubSettingsController(hosts?: string[]) {
  const refreshGitHubCli = useRefreshGitHubCliMutation(hosts)
  return {
    refreshingGitHubCli: refreshGitHubCli.isPending,
    async refreshGitHubCli(): Promise<void> {
      await runSettingsControllerAction('GitHub CLI refresh', async () => {
        await refreshGitHubCli.mutateAsync()
      })
    },
  }
}
