import { useEffect } from 'react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useSettingsStore } from '#/renderer/stores/settings.ts'

export function useBackgroundFetch() {
  const activeId = useReposStore((s) => s.activeId)
  const fetchIntervalSec = useSettingsStore((s) => s.fetchIntervalSec)

  useEffect(() => {
    if (!activeId || fetchIntervalSec <= 0) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await useReposStore.getState().backgroundFetch(activeId)
    }
    const interval = setInterval(tick, fetchIntervalSec * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeId, fetchIntervalSec])
}
