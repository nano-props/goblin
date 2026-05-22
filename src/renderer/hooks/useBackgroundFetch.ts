import { useEffect } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { canStartRemoteFetch, isRemoteFetchDue } from '#/renderer/stores/repos/sync-state.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'

export function useBackgroundFetch() {
  const activeId = useReposStore((s) => s.activeId)
  const activeFetchReady = useReposStore((s) => canStartRemoteFetch(activeId ? s.repos[activeId] : undefined))
  const fetchIntervalSec = useSettingsStore((s) => s.fetchIntervalSec)

  useEffect(() => {
    if (!activeId || fetchIntervalSec <= 0 || !activeFetchReady) return
    let cancelled = false
    const intervalMs = fetchIntervalSec * 1000
    const tick = async () => {
      if (cancelled) return
      const { activeId: currentActiveId, backgroundFetch, repos } = useReposStore.getState()
      if (!currentActiveId) return
      const repo = repos[currentActiveId]
      if (!isRemoteFetchDue(repo, intervalMs)) return
      await backgroundFetch(currentActiveId)
    }
    void tick()
    const interval = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeFetchReady, activeId, fetchIntervalSec])
}
