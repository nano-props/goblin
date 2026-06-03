import type { AppRpcHandlers } from '#/shared/rpc.ts'
import { getGitHubCliState, refreshGitHubCliState } from '#/main/settings-native-probes.ts'

export function createGitHubCliNativeRpcHandlers(options: {
  currentRpcSignal: () => AbortSignal | undefined
}): Pick<AppRpcHandlers, 'githubCli'> {
  return {
    githubCli: {
      get: async (input) => getGitHubCliState(options.currentRpcSignal(), input?.hosts),
      refresh: async (input) => refreshGitHubCliState(options.currentRpcSignal(), input?.hosts),
    },
  }
}
