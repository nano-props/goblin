import { useEffect } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { DetailTab } from '#/web/stores/repos/types.ts'
import { detailTabForWorktree } from '#/web/lib/detail-tabs.ts'
interface UseRoutedDetailTabOptions {
  currentRepoId: string | null
  sessionReady: boolean
  routeDetailTab?: DetailTab | null
  onRouteDetailTabChange?: (tab: DetailTab | null) => void
}

function activeRepoHasWorktree(repo: NonNullable<ReturnType<typeof useCurrentRepo>>): boolean {
  return (
    !!repo.ui.selectedBranch &&
    repo.data.branches.some((branch) => branch.name === repo.ui.selectedBranch && !!branch.worktree?.path)
  )
}

function useCurrentRepo(currentRepoId: string | null) {
  return useReposStore((s) => (currentRepoId ? (s.repos[currentRepoId] ?? null) : null))
}

export function useRoutedDetailTab({
  currentRepoId,
  sessionReady,
  routeDetailTab = null,
  onRouteDetailTabChange,
}: UseRoutedDetailTabOptions) {
  const activeRepo = useCurrentRepo(currentRepoId)
  const setDetailTab = useReposStore((s) => s.setDetailTab)
  const routeDriven = typeof onRouteDetailTabChange === 'function'
  const normalizedRouteTab =
    activeRepo && routeDetailTab ? detailTabForWorktree(routeDetailTab, activeRepoHasWorktree(activeRepo)) : null

  useEffect(() => {
    if (!routeDriven || !activeRepo || !routeDetailTab || !normalizedRouteTab) return
    if (normalizedRouteTab !== activeRepo.ui.detailTab) {
      setDetailTab(activeRepo.id, routeDetailTab)
    }
  }, [activeRepo, normalizedRouteTab, routeDetailTab, routeDriven, setDetailTab])

  useEffect(() => {
    if (!routeDriven) return
    if (!sessionReady) return
    if (!activeRepo) {
      if (routeDetailTab !== null) onRouteDetailTabChange?.(null)
      return
    }
    if (routeDetailTab) {
      if (normalizedRouteTab === activeRepo.ui.detailTab) {
        if (normalizedRouteTab !== routeDetailTab) onRouteDetailTabChange?.(normalizedRouteTab)
        return
      }
      if (normalizedRouteTab !== null) return
      onRouteDetailTabChange?.(activeRepo.ui.detailTab)
      return
    }
    onRouteDetailTabChange?.(activeRepo.ui.detailTab)
  }, [activeRepo, normalizedRouteTab, onRouteDetailTabChange, routeDetailTab, routeDriven, sessionReady])
}
