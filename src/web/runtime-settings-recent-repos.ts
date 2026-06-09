import { currentRuntimeRecentReposState, useRuntimeRecentReposState } from '#/web/runtime-settings-snapshot.ts'

export function getRuntimeRecentRepos() {
  return currentRuntimeRecentReposState()?.recentRepos ?? []
}

export function useRuntimeRecentRepos() {
  return useRuntimeRecentReposState()?.recentRepos ?? []
}
