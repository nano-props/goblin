import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { runRepoProjectionPromotion } from '#/web/repo-projection-promotion-command.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

export type RepoProjectionPromotionViewState =
  { phase: 'idle' } | { phase: 'promoting' } | { phase: 'failed'; message: string }

interface LazyRestoreTarget {
  repoRoot: string
  repoRuntimeId: string
  projectionState: 'projected' | 'stub'
}

interface PromotionTargetIdentity {
  repoRoot: string
  repoRuntimeId: string
}

interface TargetPromotionViewState {
  target: PromotionTargetIdentity
  state: RepoProjectionPromotionViewState
}

const IDLE_PROMOTION_VIEW_STATE: RepoProjectionPromotionViewState = { phase: 'idle' }

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
      }
    }),
  )
  const [attempt, setAttempt] = useState(0)
  const [targetState, setTargetState] = useState<TargetPromotionViewState | null>(null)

  useEffect(() => {
    if (target?.projectionState !== 'stub') return
    const targetIdentity = { repoRoot: target.repoRoot, repoRuntimeId: target.repoRuntimeId }
    let current = true
    setTargetState({ target: targetIdentity, state: { phase: 'promoting' } })
    void runRepoProjectionPromotion({
      repoRoot: target.repoRoot,
      repoRuntimeId: target.repoRuntimeId,
    }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setTargetState({ target: targetIdentity, state: { phase: 'failed', message: result.message } })
        return
      }
      useReposStore.getState().promoteRestoredWorkspaceRepo({ repo: result.repo, snapshot: result.snapshot })
    })
    return () => {
      current = false
    }
  }, [attempt, target])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const state = promotionStateForCurrentTarget(targetState, target)
  return { state, retry }
}

function promotionStateForCurrentTarget(
  targetState: TargetPromotionViewState | null,
  target: LazyRestoreTarget | null,
): RepoProjectionPromotionViewState {
  if (
    !targetState ||
    target?.projectionState !== 'stub' ||
    targetState.target.repoRoot !== target.repoRoot ||
    targetState.target.repoRuntimeId !== target.repoRuntimeId
  ) {
    return IDLE_PROMOTION_VIEW_STATE
  }
  return targetState.state
}
