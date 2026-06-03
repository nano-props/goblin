import type { RepoState, ReposStore } from '#/web/stores/repos/types.ts'

function isBackgroundSyncEligible(repo: RepoState | undefined): repo is RepoState {
  return !!repo && repo.availability.phase !== 'unavailable' && repo.remote.hasRemotes === true
}

export function backgroundSyncRepoIdsFromStore(state: Pick<ReposStore, 'activeId' | 'repos'>): string[] {
  const repoId = state.activeId
  if (!repoId) return []
  return isBackgroundSyncEligible(state.repos[repoId]) ? [repoId] : []
}
