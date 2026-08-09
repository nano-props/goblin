import { computed, ref, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { runWorkspaceProjectionPromotion } from '#/web/workspace-projection-promotion-command.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

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

export function useRestoreWorkspaceTabsOnView({ workspaceId }: { workspaceId: MaybeRefOrGetter<WorkspaceId | null> }) {
  const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
  const target = computed<LazyRestoreTarget | null>(() => {
    const id = toValue(workspaceId)
    if (!id) return null
    const workspace = workspaces.value[id]
    if (!workspace) return null
    return {
      workspaceId: workspace.id,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      projectionState: workspace.session.projectionState,
    }
  })
  const attempt = ref(0)
  const targetState = shallowRef<TargetPromotionViewState | null>(null)
  const promotionKey = computed(() => {
    const current = target.value
    return current?.projectionState === 'stub'
      ? `${current.workspaceId}\0${current.workspaceRuntimeId}\0${attempt.value}`
      : null
  })

  // Each key owns one promotion attempt; cleanup prevents a superseded target
  // from publishing its result into the current projection.
  watch(
    promotionKey,
    (key, _previous, onCleanup) => {
      const currentTarget = target.value
      if (!key || currentTarget?.projectionState !== 'stub') return
      const targetIdentity = {
        workspaceId: currentTarget.workspaceId,
        workspaceRuntimeId: currentTarget.workspaceRuntimeId,
      }
      let current = true
      onCleanup(() => {
        current = false
      })
      targetState.value = { target: targetIdentity, state: { phase: 'promoting' } }
      void runWorkspaceProjectionPromotion({
        workspaceId: currentTarget.workspaceId,
        workspaceRuntimeId: currentTarget.workspaceRuntimeId,
      }).then((result) => {
        if (!current) return
        if (!result.ok) {
          targetState.value = { target: targetIdentity, state: { phase: 'failed', message: result.message } }
          return
        }
        workspacesStore.getState().promoteRestoredWorkspace({
          workspace: result.workspace,
          snapshot: result.snapshot,
        })
      })
    },
    { immediate: true },
  )

  const retry = () => {
    attempt.value += 1
  }
  const state = computed(() => promotionStateForCurrentTarget(targetState.value, target.value))
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
