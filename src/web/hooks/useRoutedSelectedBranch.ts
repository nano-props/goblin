import { useEffect } from 'react'
import { useReposStore } from '#/web/stores/repos/store.ts'
interface UseRoutedSelectedBranchOptions {
  currentRepoId: string | null
  sessionReady: boolean
  routeBranch?: string | null
  onRouteBranchChange?: (branch: string | null) => void
}

function useCurrentRepo(currentRepoId: string | null) {
  return useReposStore((s) => (currentRepoId ? (s.repos[currentRepoId] ?? null) : null))
}

export function useRoutedSelectedBranch({
  currentRepoId,
  sessionReady,
  routeBranch = null,
  onRouteBranchChange,
}: UseRoutedSelectedBranchOptions) {
  const activeRepo = useCurrentRepo(currentRepoId)
  const selectBranch = useReposStore((s) => s.selectBranch)
  const routeDriven = typeof onRouteBranchChange === 'function'
  const routeBranchExists =
    !!routeBranch && !!activeRepo && activeRepo.data.branches.some((branch) => branch.name === routeBranch)

  useEffect(() => {
    if (!routeDriven) return
    if (!activeRepo) return
    if (!routeBranch) return
    if (!routeBranchExists) return
    if (activeRepo.ui.selectedBranch !== routeBranch) {
      selectBranch(activeRepo.id, routeBranch)
    }
  }, [activeRepo, routeBranch, routeBranchExists, routeDriven, selectBranch])

  useEffect(() => {
    if (!routeDriven) return
    if (!sessionReady) return
    if (!activeRepo) {
      if (routeBranch !== null) onRouteBranchChange?.(null)
      return
    }
    if (routeBranch) {
      if (routeBranchExists) return
      if (routeBranch !== activeRepo.ui.selectedBranch) onRouteBranchChange?.(activeRepo.ui.selectedBranch)
      return
    }
    if (activeRepo.ui.selectedBranch !== null) onRouteBranchChange?.(activeRepo.ui.selectedBranch)
  }, [activeRepo, onRouteBranchChange, routeBranch, routeBranchExists, routeDriven, sessionReady])
}
