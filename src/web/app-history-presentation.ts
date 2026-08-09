import { onScopeDispose } from 'vue'
import { useRouter } from 'vue-router'
import type { HistoryState } from 'vue-router'
import { observeAppHistoryNavigation } from '#/web/app-navigation-lifecycle.ts'

export type AppHistoryPresentationAction =
  { href: string; type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { href: string; type: 'GO'; index: number }

interface VueHistoryNavigationInformation {
  delta: number
  type: 'pop' | 'push'
  direction: 'back' | 'forward' | ''
}

let pendingMutation: AppHistoryPresentationAction | null = null
let pendingTraversal: AppHistoryPresentationAction | null = null
let presentedAction: AppHistoryPresentationAction | null = null

export function markAppHistoryMutation(href: string, replace: boolean): void {
  pendingMutation = { href, type: replace ? 'REPLACE' : 'PUSH' }
}

export function takeAppHistoryPresentationAction(href: string): AppHistoryPresentationAction | null {
  if (presentedAction?.href !== href) return null
  const action = presentedAction
  presentedAction = null
  return action
}

/** One mounted owner connects Vue Router settlement to app navigation ownership. */
export function useAppHistoryPresentationObserver(): void {
  const router = useRouter()
  const removeHistoryListener = router.options.history.listen((to, _from, information) => {
    pendingTraversal = traversalAction(to, information as VueHistoryNavigationInformation)
  })
  const removeAfterEach = router.afterEach((to, _from, failure) => {
    const href = to.fullPath
    if (failure) {
      pendingMutation = null
      pendingTraversal = null
      return
    }

    const action = actionForSettledHref(href)
    const state = router.options.history.state as HistoryState
    observeAppHistoryNavigation({ href, state, action: navigationLifecycleAction(action) })
    presentedAction = action
  })

  onScopeDispose(() => {
    removeAfterEach()
    removeHistoryListener()
  })
}

function actionForSettledHref(href: string): AppHistoryPresentationAction {
  const traversal = pendingTraversal
  const mutation = pendingMutation
  pendingTraversal = null
  pendingMutation = null
  if (traversal?.href === href) return traversal
  if (mutation?.href === href) return mutation
  return { href, type: 'REPLACE' }
}

function traversalAction(href: string, information: VueHistoryNavigationInformation): AppHistoryPresentationAction {
  if (Math.abs(information.delta) > 1) return { href, type: 'GO', index: information.delta }
  if (information.direction === 'forward' || information.delta > 0) return { href, type: 'FORWARD' }
  return { href, type: 'BACK' }
}

function navigationLifecycleAction(
  action: AppHistoryPresentationAction,
): { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number } {
  return action.type === 'GO' ? { type: 'GO', index: action.index } : { type: action.type }
}
