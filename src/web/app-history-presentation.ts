import { onScopeDispose } from 'vue'
import { useRouter } from 'vue-router'
import type { HistoryState, Router, RouterHistory } from 'vue-router'
import { createOpaqueId, isOpaqueId } from '#/shared/opaque-id.ts'
import { observeAppHistoryNavigation } from '#/web/app-navigation-lifecycle.ts'

const APP_HISTORY_ENTRY_ID_STATE_KEY = '__goblinAppHistoryEntryId' as const

export type AppHistoryPresentationAction =
  { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }

export interface AppHistoryPresentation {
  settlementId: number
  action: AppHistoryPresentationAction
}

interface VueHistoryNavigationInformation {
  delta: number
  type: 'pop' | 'push'
  direction: 'back' | 'forward' | ''
}

interface AppHistoryPresentationController {
  current(): AppHistoryPresentation
  consumeCurrentAction(): AppHistoryPresentationAction | null
  settleCurrent(): AppHistoryPresentation
}

const appHistoryPresentationControllers = new WeakMap<RouterHistory, AppHistoryPresentationController>()

/**
 * Gives every history entry a stable identity. Vue Router calls push/replace
 * only after a mutation passes its guards; traversal metadata is keyed to its
 * target entry and published only after router settlement. In-flight
 * navigations therefore never share presentation state.
 */
export function createAppHistoryPresentationHistory(history: RouterHistory): RouterHistory {
  let nextSettlementId = 0
  let consumedSettlementId: number | null = null
  let pendingTraversal: { entryId: string; action: AppHistoryPresentationAction } | null = null
  const legacyEntryIdByState = new WeakMap<object, string>()

  const createPresentation = (action: AppHistoryPresentationAction): AppHistoryPresentation => ({
    settlementId: ++nextSettlementId,
    action,
  })
  const currentEntryId = (): string => {
    const storedEntryId = storedAppHistoryEntryId(history.state)
    if (storedEntryId) return storedEntryId
    const position = history.state.position
    if (typeof position === 'number' && Number.isSafeInteger(position)) {
      return `history-entry-legacy-${position}`
    }
    const existingEntryId = legacyEntryIdByState.get(history.state)
    if (existingEntryId) return existingEntryId
    const entryId = createOpaqueId('history-entry-legacy')
    legacyEntryIdByState.set(history.state, entryId)
    return entryId
  }
  let presentedEntryId = currentEntryId()
  let currentPresentation = createPresentation({ type: 'REPLACE' })
  const commitPresentation = (entryId: string, action: AppHistoryPresentationAction): AppHistoryPresentation => {
    const presentation = createPresentation(action)
    presentedEntryId = entryId
    currentPresentation = presentation
    pendingTraversal = null
    return presentation
  }

  const removeTraversalListener = history.listen((_to, _from, information) => {
    pendingTraversal = {
      entryId: currentEntryId(),
      action: traversalPresentationAction(information as VueHistoryNavigationInformation),
    }
  })

  const wrappedHistory: RouterHistory = {
    base: history.base,
    get location() {
      return history.location
    },
    get state() {
      return history.state
    },
    push(to, data) {
      const entryId = createOpaqueId('history-entry')
      history.push(to, appHistoryStateWithEntryId(data ?? {}, entryId))
      commitPresentation(entryId, { type: 'PUSH' })
    },
    replace(to, data) {
      const entryId = storedAppHistoryEntryId(history.state) ?? createOpaqueId('history-entry')
      history.replace(to, appHistoryStateWithEntryId(data ?? {}, entryId))
      commitPresentation(entryId, { type: 'REPLACE' })
    },
    go(delta, triggerListeners) {
      history.go(delta, triggerListeners)
    },
    listen(callback) {
      return history.listen(callback)
    },
    createHref(location) {
      return history.createHref(location)
    },
    destroy() {
      removeTraversalListener()
      appHistoryPresentationControllers.delete(wrappedHistory)
      pendingTraversal = null
      history.destroy()
    },
  }

  appHistoryPresentationControllers.set(wrappedHistory, {
    current() {
      return currentPresentation
    },
    consumeCurrentAction() {
      if (currentPresentation.settlementId === consumedSettlementId) return null
      consumedSettlementId = currentPresentation.settlementId
      return currentPresentation.action
    },
    settleCurrent() {
      const entryId = currentEntryId()
      if (pendingTraversal?.entryId === entryId) {
        return commitPresentation(entryId, pendingTraversal.action)
      }
      if (entryId !== presentedEntryId) {
        throw new Error('Vue Router history entry changed without a committed app presentation')
      }
      return currentPresentation
    },
  })
  return wrappedHistory
}

function storedAppHistoryEntryId(state: HistoryState): string | null {
  const value = state[APP_HISTORY_ENTRY_ID_STATE_KEY]
  return isOpaqueId(value) ? value : null
}

/** One mounted owner connects committed Vue Router history entries to app navigation ownership. */
export function useAppHistoryPresentationObserver(): void {
  const router = useRouter()
  onScopeDispose(installAppHistoryPresentationObserver(router))
}

export function installAppHistoryPresentationObserver(router: Router): () => void {
  return router.afterEach((to, _from, failure) => {
    if (failure) return
    const presentation = settleAppHistoryPresentation(router.options.history)
    observeAppHistoryNavigation({ href: to.fullPath, state: router.options.history.state, action: presentation.action })
  })
}

export function requireAppHistoryPresentation(history: RouterHistory): AppHistoryPresentation {
  const controller = appHistoryPresentationControllers.get(history)
  if (!controller) throw new Error('Vue Router must use the app history presentation adapter')
  return controller.current()
}

export function consumeAppHistoryPresentationAction(history: RouterHistory): AppHistoryPresentationAction | null {
  const controller = appHistoryPresentationControllers.get(history)
  if (!controller) throw new Error('Vue Router must use the app history presentation adapter')
  return controller.consumeCurrentAction()
}

function settleAppHistoryPresentation(history: RouterHistory): AppHistoryPresentation {
  const controller = appHistoryPresentationControllers.get(history)
  if (!controller) throw new Error('Vue Router must use the app history presentation adapter')
  return controller.settleCurrent()
}

function appHistoryStateWithEntryId(state: HistoryState, entryId: string): HistoryState {
  return { ...state, [APP_HISTORY_ENTRY_ID_STATE_KEY]: entryId }
}

function traversalPresentationAction(information: VueHistoryNavigationInformation): AppHistoryPresentationAction {
  if (Math.abs(information.delta) > 1) return { type: 'GO', index: information.delta }
  if (information.direction === 'forward' || information.delta > 0) return { type: 'FORWARD' }
  return { type: 'BACK' }
}
