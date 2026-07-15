import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import { runRepoProjectionPromotion } from '#/web/repo-projection-promotion-command.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

export type RepoProjectionPromotionViewState =
  | { phase: 'idle' }
  | { phase: 'promoting' }
  | { phase: 'failed'; message: string }

interface LazyRestoreTarget {
  repoRoot: string
  repoRuntimeId: string
  projectionState: 'projected' | 'stub'
  entry: RepoSessionEntry | null
}

export function useRestoreRepoTabsOnView({ repoId }: { repoId: string | null }) {
  const target = useReposStore(
    useShallow((state): LazyRestoreTarget | null => {
      if (!repoId) return null
      const repo = state.repos[repoId]
      if (!repo) return null
      return {
        repoRoot: repo.id,
        repoRuntimeId: repo.repoRuntimeId,
        projectionState: repo.session.projectionState,
        entry: repo.session.entry,
      }
    }),
  )
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<RepoProjectionPromotionViewState>({ phase: 'idle' })

  useEffect(() => {
    if (target?.projectionState !== 'stub' || !target.entry) {
      setState({ phase: 'idle' })
      return
    }
    let current = true
    setState({ phase: 'promoting' })
    void runRepoProjectionPromotion({
      repoRoot: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
      entry: target.entry,
    }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setState({ phase: 'failed', message: result.message })
        return
      }
      useReposStore.getState().promoteRestoredWorkspaceRepo({ repo: result.repo, snapshot: result.snapshot })
    })
    return () => {
      current = false
    }
  }, [attempt, target])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { state, retry }
}
