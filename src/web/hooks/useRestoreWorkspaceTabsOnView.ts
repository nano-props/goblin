import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { runWorkspaceProjectionPromotion } from '#/web/workspace-projection-promotion-command.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type WorkspaceProjectionPromotionViewState =
  { phase: 'idle' } | { phase: 'promoting' } | { phase: 'failed'; message: string }

interface LazyRestoreTarget {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  projectionState: 'projected' | 'stub'
}

interface PromotionTargetIdentity {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
}

interface TargetPromotionViewState {
  target: PromotionTargetIdentity
  state: WorkspaceProjectionPromotionViewState
}

const IDLE_PROMOTION_VIEW_STATE: WorkspaceProjectionPromotionViewState = { phase: 'idle' }

export function useRestoreWorkspaceTabsOnView({ workspaceId }: { workspaceId: string | null }) {
  const target = useWorkspacesStore(
    useShallow((state): LazyRestoreTarget | null => {
      if (!workspaceId) return null
      const workspace = state.workspaces[workspaceId]
      if (!workspace) return null
      return {
        workspaceId: workspace.id,
        workspaceRuntimeId: workspace.workspaceRuntimeId,
        projectionState: workspace.session.projectionState,
      }
    }),
  )
  const [attempt, setAttempt] = useState(0)
  const [targetState, setTargetState] = useState<TargetPromotionViewState | null>(null)

  useEffect(() => {
    if (target?.projectionState !== 'stub') return
    const targetIdentity = { workspaceId: target.workspaceId, workspaceRuntimeId: target.workspaceRuntimeId }
    let current = true
    setTargetState({ target: targetIdentity, state: { phase: 'promoting' } })
    void runWorkspaceProjectionPromotion({
      workspaceId: target.workspaceId,
      workspaceRuntimeId: target.workspaceRuntimeId,
    }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setTargetState({ target: targetIdentity, state: { phase: 'failed', message: result.message } })
        return
      }
      useWorkspacesStore.getState().promoteRestoredWorkspace({
        workspace: result.workspace,
        snapshot: result.snapshot,
      })
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
): WorkspaceProjectionPromotionViewState {
  if (
    !targetState ||
    target?.projectionState !== 'stub' ||
    targetState.target.workspaceId !== target.workspaceId ||
    targetState.target.workspaceRuntimeId !== target.workspaceRuntimeId
  ) {
    return IDLE_PROMOTION_VIEW_STATE
  }
  return targetState.state
}
