import { openProjectGitHub as launchProjectGitHub } from '#/web/app-shell-client.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'

export function useAboutSettingsController() {
  return {
    async openProjectGitHub(): Promise<void> {
      await runSettingsControllerAction('open project GitHub', async () => {
        await launchProjectGitHub()
      })
    },
  }
}
