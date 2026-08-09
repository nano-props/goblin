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
  const presentationByEntryId = new Map<string, AppHistoryPresentation>()
  const traversalActionByEntryId = new Map<string, AppHistoryPresentationAction>()
  const legacyEntryIdByPosition = new Map<number, string>()
  const legacyEntryIdByState = new WeakMap<object, string>()

  const createPresentation = (action: AppHistoryPresentationAction): AppHistoryPresentation => ({
    settlementId: ++nextSettlementId,
    action,
  })
  const entryIdForState = (state: HistoryState): string => {
    const storedEntryId = storedAppHistoryEntryId(state)
    if (storedEntryId) return storedEntryId
    const position = state.position
    if (typeof position === 'number' && Number.isSafeInteger(position)) {
      const existingEntryId = legacyEntryIdByPosition.get(position)
      if (existingEntryId) return existingEntryId
      const entryId = createOpaqueId('history-entry')
      legacyEntryIdByPosition.set(position, entryId)
      return entryId
    }
    const existingEntryId = legacyEntryIdByState.get(state)
    if (existingEntryId) return existingEntryId
    const entryId = createOpaqueId('history-entry')
    legacyEntryIdByState.set(state, entryId)
    return entryId
  }
  const currentEntryId = (): string => entryIdForState(history.state)
  let presentedEntryId = currentEntryId()
  const commitPresentation = (entryId: string, action: AppHistoryPresentationAction): AppHistoryPresentation => {
    const presentation = createPresentation(action)
    presentationByEntryId.set(entryId, presentation)
    presentedEntryId = entryId
    return presentation
  }

  commitPresentation(presentedEntryId, { type: 'REPLACE' })

  const removeTraversalListener = history.listen((_to, _from, information) => {
    traversalActionByEntryId.set(
      currentEntryId(),
      traversalPresentationAction(information as VueHistoryNavigationInformation),
    )
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
      const entryId = currentEntryId()
      history.replace(to, appHistoryStateWithEntryId(data ?? {}, entryId))
      traversalActionByEntryId.delete(entryId)
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
      presentationByEntryId.clear()
      traversalActionByEntryId.clear()
      history.destroy()
    },
  }

  appHistoryPresentationControllers.set(wrappedHistory, {
    current() {
      const presentation = presentationByEntryId.get(presentedEntryId)
      if (!presentation) throw new Error('Vue Router history entry is missing app presentation metadata')
      return presentation
    },
    consumeCurrentAction() {
      const presentation = presentationByEntryId.get(presentedEntryId)
      if (!presentation) throw new Error('Vue Router history entry is missing app presentation metadata')
      if (presentation.settlementId === consumedSettlementId) return null
      consumedSettlementId = presentation.settlementId
      return presentation.action
    },
    settleCurrent() {
      const entryId = currentEntryId()
      const traversalAction = traversalActionByEntryId.get(entryId)
      if (traversalAction) {
        traversalActionByEntryId.delete(entryId)
        return commitPresentation(entryId, traversalAction)
      }
      const presentation = presentationByEntryId.get(entryId)
      if (!presentation) throw new Error('Vue Router history entry is missing app presentation metadata')
      presentedEntryId = entryId
      return presentation
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
