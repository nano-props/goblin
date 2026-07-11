import type { HistoryState } from '@tanstack/history'

declare module '@tanstack/history' {
  interface HistoryState {
    __goblinPrimaryWindowNavigationId?: string
  }
}

export interface PrimaryWindowPresentationToken {
  generation: number
}

export const PRIMARY_WINDOW_NAVIGATION_STATE_KEY = '__goblinPrimaryWindowNavigationId' as const

interface PrimaryWindowOwnedNavigation {
  token: PrimaryWindowPresentationToken
  targetHref: string
  commitEffect?: () => void
}

let latestPrimaryWindowPresentationGeneration = 0
let nextPrimaryWindowNavigationId = 1
const ownedPrimaryWindowNavigations = new Map<string, PrimaryWindowOwnedNavigation>()

export function beginPrimaryWindowPresentation(): PrimaryWindowPresentationToken {
  latestPrimaryWindowPresentationGeneration += 1
  return { generation: latestPrimaryWindowPresentationGeneration }
}

export function primaryWindowPresentationIsCurrent(token: PrimaryWindowPresentationToken): boolean {
  return token.generation === latestPrimaryWindowPresentationGeneration
}

export function registerPrimaryWindowNavigation(
  token: PrimaryWindowPresentationToken,
  targetHref: string,
  commitEffect?: () => void,
): string | null {
  if (!primaryWindowPresentationIsCurrent(token)) return null
  const navigationId = `primary-window-${token.generation}-${nextPrimaryWindowNavigationId++}`
  ownedPrimaryWindowNavigations.set(navigationId, { token, targetHref, commitEffect })
  return navigationId
}

export function releasePrimaryWindowNavigation(navigationId: string): void {
  ownedPrimaryWindowNavigations.delete(navigationId)
}

export function primaryWindowNavigationState(
  state: HistoryState,
  navigationId: string,
): HistoryState {
  return { ...state, [PRIMARY_WINDOW_NAVIGATION_STATE_KEY]: navigationId }
}

export function observePrimaryWindowHistoryNavigation(input: {
  href: string
  state: HistoryState | undefined
  action: { type: 'BACK' | 'FORWARD' | 'PUSH' | 'REPLACE' } | { type: 'GO'; index: number }
}): void {
  if (input.action.type === 'BACK' || input.action.type === 'FORWARD' || input.action.type === 'GO') {
    beginPrimaryWindowPresentation()
    return
  }
  const navigationId = input.state?.[PRIMARY_WINDOW_NAVIGATION_STATE_KEY]
  const owned = navigationId ? ownedPrimaryWindowNavigations.get(navigationId) : null
  if (navigationId && owned && owned.targetHref === input.href) {
    ownedPrimaryWindowNavigations.delete(navigationId)
    if (primaryWindowPresentationIsCurrent(owned.token)) owned.commitEffect?.()
    return
  }
  beginPrimaryWindowPresentation()
}

export function resetPrimaryWindowPresentationForTest(): void {
  latestPrimaryWindowPresentationGeneration = 0
  nextPrimaryWindowNavigationId = 1
  ownedPrimaryWindowNavigations.clear()
}
