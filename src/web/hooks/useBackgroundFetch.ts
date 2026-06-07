import { useEffect } from 'react'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { setBackgroundSyncRepos } from '#/web/app-data-client.ts'
import type { RepoState, ReposStore } from '#/web/stores/repos/types.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRuntimeFetchSettings } from '#/web/runtime-settings-hooks.ts'

function isBackgroundSyncEligible(repo: RepoState | undefined): repo is RepoState {
  return !!repo && repo.availability.phase !== 'unavailable' && repo.remote.hasRemotes === true
}

export function backgroundSyncRepoIdsFromStore(state: Pick<ReposStore, 'activeId' | 'repos'>): string[] {
  const activeRepoId = state.activeId
  if (!activeRepoId) return []
  return isBackgroundSyncEligible(state.repos[activeRepoId]) ? [activeRepoId] : []
}

export function useBackgroundFetch() {
  const eligibleRepoIdsKey = useReposStore((s) => backgroundSyncRepoIdsFromStore(s).join('\0'))
  const { fetchIntervalSec } = useRuntimeFetchSettings()
  const hasEmbeddedServer = !!getInitialBootstrap().initialServer?.url

  useEffect(() => {
    if (!hasEmbeddedServer) return
    const repoIds = fetchIntervalSec > 0 ? eligibleRepoIdsKey.split('\0').filter(Boolean) : []
    void setBackgroundSyncRepos(repoIds)
  }, [eligibleRepoIdsKey, fetchIntervalSec, hasEmbeddedServer])

  useEffect(() => {
    if (!hasEmbeddedServer) return
    return () => {
      void setBackgroundSyncRepos([])
    }
  }, [hasEmbeddedServer])
}
