import { useEffect } from 'react'
import { setBackgroundSyncRepos } from '#/web/repo-client.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState, ReposStore } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { activeRepoFromStore } from '#/web/stores/repos/selector-state.ts'
import { useFetchSettings } from '#/web/runtime-settings-fetch.ts'
import { hasClientServerConfig } from '#/web/lib/server-config.ts'

function isBackgroundSyncEligible(repo: RepoState | null | undefined): repo is RepoState {
  return !!repo && !isRepoUnavailable(repo) && repo.remote.hasRemotes === true
}

export function backgroundSyncRepoIdsFromStore(state: Pick<ReposStore, 'activeId' | 'repos'>): string[] {
  const activeRepo = activeRepoFromStore(state)
  return isBackgroundSyncEligible(activeRepo) ? [activeRepo.id] : []
}

export function useBackgroundFetch() {
  const eligibleRepoIdsKey = useReposStore((s) => backgroundSyncRepoIdsFromStore(s).join('\0'))
  const { fetchIntervalSec } = useFetchSettings()
  const hasServer = hasClientServerConfig()

  useEffect(() => {
    if (!hasServer) return
    const repoIds = fetchIntervalSec > 0 ? eligibleRepoIdsKey.split('\0').filter(Boolean) : []
    void setBackgroundSyncRepos(repoIds)
  }, [eligibleRepoIdsKey, fetchIntervalSec, hasServer])
}
