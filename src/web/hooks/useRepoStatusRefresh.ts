import { useEffect, useRef } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

interface ActiveRepoStatusSnapshot {
  id: string
  token: number
  workspacePaneView: WorkspacePaneView
  /**
   * Phase 4: the snapshot's `availability` is now derived from
   * the lifecycle union (via `isRepoUnavailable`) so the field
   * correctly reflects BOTH local (`availability.phase`) and
   * remote (`remote.lifecycle.kind === 'failed'`) terminals.
   */
  unavailable: boolean
  statusPhase: 'idle' | 'loading' | 'refreshing'
}

function activeRepoStatusSnapshotEqual(
  a: ActiveRepoStatusSnapshot | null,
  b: ActiveRepoStatusSnapshot | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.token === b.token &&
      a.workspacePaneView === b.workspacePaneView &&
      a.unavailable === b.unavailable &&
      a.statusPhase === b.statusPhase)
  )
}

// Basic gate: don't kick off a refresh for an unavailable repo, and don't
// double-fire while a previous refresh is still in flight. Concurrency is
// the only thing the gate protects against; rate limiting is intentionally
// not implemented here. The IPC round trip + server-side `git status` cost
// acts as a natural throttle, and the user opening a status-like tab or
// switching repos is an explicit "I want fresh data" signal — we shouldn't
// second-guess it.
export function isRepoStatusRefreshable(repo: ActiveRepoStatusSnapshot): boolean {
  return !repo.unavailable && repo.statusPhase === 'idle'
}

export function useRepoStatusRefresh() {
  const activeRepo = useStoreWithEqualityFn(
    useReposStore,
    (state): ActiveRepoStatusSnapshot | null => {
      const id = state.activeId
      const repo = id ? state.repos[id] : null
      if (!repo) return null
      return {
        id: repo.id,
        token: repo.instanceToken,
        workspacePaneView: repo.ui.preferredWorkspacePaneView,
        unavailable: isRepoUnavailable(repo),
        statusPhase: repo.resources.status.phase,
      }
    },
    activeRepoStatusSnapshotEqual,
  )
  const previousActiveRepoId = useRef<string | null>(null)
  const previousWorkspacePaneView = useRef<WorkspacePaneView | null>(null)

  useEffect(() => {
    const lastActiveRepoId = previousActiveRepoId.current
    const lastWorkspacePaneView = previousWorkspacePaneView.current
    const nextActiveRepoId = activeRepo?.id ?? null
    const nextWorkspacePaneView = activeRepo?.workspacePaneView ?? null
    const activeRepoChanged = nextActiveRepoId !== lastActiveRepoId
    const openedStatusLikeTab =
      !activeRepoChanged &&
      nextActiveRepoId !== null &&
      (nextWorkspacePaneView === 'status' || nextWorkspacePaneView === 'changes') &&
      nextWorkspacePaneView !== lastWorkspacePaneView
    previousActiveRepoId.current = nextActiveRepoId
    previousWorkspacePaneView.current = nextWorkspacePaneView
    if (!activeRepo || (!activeRepoChanged && !openedStatusLikeTab)) return
    if (!isRepoStatusRefreshable(activeRepo)) return
    void useReposStore.getState().refreshStatus(activeRepo.id, { token: activeRepo.token })
  }, [activeRepo])
}
