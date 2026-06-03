import { useEffect } from 'react'
import { getInitialBootstrap } from '#/web/bootstrap.ts'
import { setBackgroundSyncRepos } from '#/web/app-data-client.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useSettingsStore } from '#/web/stores/settings.ts'
import { backgroundSyncRepoIdsFromStore } from '#/web/hooks/background-sync.ts'
export function useBackgroundFetch() {
  const eligibleRepoIdsKey = useReposStore((s) => backgroundSyncRepoIdsFromStore(s).join('\0'))
  const fetchIntervalSec = useSettingsStore((s) => s.fetchIntervalSec)
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
