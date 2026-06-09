import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'
import { refreshGitHubCliDetection } from '#/web/settings-write-paths.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'

export function useGitHubSettingsController(hosts?: string[]) {
  const { isPending: refreshingGitHubCli, run } = useAsyncPending<'refresh'>()
  return {
    refreshingGitHubCli,
    async refreshGitHubCli(): Promise<void> {
      await run('refresh', async () => {
        await runSettingsControllerAction('GitHub CLI refresh', async () => {
          await refreshGitHubCliDetection(hosts)
        })
      })
    },
  }
}
