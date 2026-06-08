import type { DetailTab } from '#/web/stores/repos/types.ts'
export type DetailTabNavigationKey = 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End'

export const DETAIL_TABS = [
  { id: 'status', labelKey: 'tab.status' },
  { id: 'changes', labelKey: 'tab.changes' },
  { id: 'terminal', labelKey: 'tab.terminal' },
] as const satisfies readonly { id: DetailTab; labelKey: string }[]

export function isDetailTab(value: string | null | undefined): value is DetailTab {
  return value === 'status' || value === 'changes' || value === 'terminal'
}

export function visibleDetailTabs(hasWorktree: boolean) {
  return hasWorktree ? DETAIL_TABS : DETAIL_TABS.filter((tab) => tab.id !== 'terminal')
}

export function detailTabForWorktree(tab: DetailTab, hasWorktree: boolean): DetailTab {
  if (tab === 'terminal') return hasWorktree ? tab : 'status'
  return tab
}

export function detailTabNavigationKey(key: string): DetailTabNavigationKey | null {
  return key === 'ArrowRight' || key === 'ArrowLeft' || key === 'Home' || key === 'End' ? key : null
}

// Shared by the ARIA tablist handler and global shortcuts; callers own focus and collapse side effects.
export function navigatedDetailTab(current: DetailTab, key: DetailTabNavigationKey, hasWorktree = true): DetailTab {
  const tabs = visibleDetailTabs(hasWorktree)
  const visibleCurrent = detailTabForWorktree(current, hasWorktree)
  // If the current tab disappeared from the visible set, navigate from the first tab.
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === visibleCurrent),
  )
  const next =
    key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : key === 'ArrowLeft'
        ? (index - 1 + tabs.length) % tabs.length
        : key === 'Home'
          ? 0
          : tabs.length - 1
  return tabs[next].id
}

export function adjacentDetailTab(current: DetailTab, direction: 1 | -1, hasWorktree = true): DetailTab {
  return navigatedDetailTab(current, direction === 1 ? 'ArrowRight' : 'ArrowLeft', hasWorktree)
}
