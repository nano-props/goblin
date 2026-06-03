import { app } from 'electron'
import { createExternalAppsNativeRpcHandlers } from '#/main/external-apps-native-rpc.ts'
import { createGitHubCliNativeRpcHandlers } from '#/main/github-cli-native-rpc.ts'
import { createI18nNativeRpcHandlers } from '#/main/i18n-native-rpc.ts'
import { createSettingsNativeRpcHandlers } from '#/main/settings-native-rpc.ts'
import { createThemeNativeRpcHandlers } from '#/main/theme-native-rpc.ts'
import type { AppRpcHandlers } from '#/shared/rpc.ts'

export function createNativeRpcHandlers(options: {
  currentRpcSignal: () => AbortSignal | undefined
}): Pick<AppRpcHandlers, 'theme' | 'settings' | 'externalApps' | 'githubCli' | 'i18n'> {
  return {
    ...createThemeNativeRpcHandlers(),
    ...createSettingsNativeRpcHandlers({
      currentRpcSignal: options.currentRpcSignal,
      addRecentDocument: (path) => app.addRecentDocument(path),
    }),
    ...createExternalAppsNativeRpcHandlers({ currentRpcSignal: options.currentRpcSignal }),
    ...createGitHubCliNativeRpcHandlers({ currentRpcSignal: options.currentRpcSignal }),
    ...createI18nNativeRpcHandlers(),
  }
}
