import { useEffect } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
interface UseRoutedActiveRepoOptions {
  activeId: string | null
  sessionReady: boolean
  routeRepoId?: string | null
  onRouteRepoChange?: (repoId: string | null) => void
}

export function useRoutedActiveRepo({
  activeId,
  sessionReady,
  routeRepoId = null,
  onRouteRepoChange,
}: UseRoutedActiveRepoOptions) {
  const repos = useReposStore((s) => s.repos)
  const routeDriven = typeof onRouteRepoChange === 'function'
  const routeRepoExists = !!routeRepoId && routeRepoId in repos

  useEffect(() => {
    if (!routeDriven) return
    if (!sessionReady) return
    if (routeRepoId) {
      if (routeRepoExists) return
      if (activeId !== routeRepoId) onRouteRepoChange?.(activeId)
      return
    }
    if (activeId !== null) onRouteRepoChange?.(activeId)
  }, [activeId, onRouteRepoChange, routeDriven, routeRepoExists, routeRepoId, sessionReady])
}
