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

/**
 * Resolve the detail tab the UI should actually render.
 *
 * The repos store holds the user's *preferred* tab (the persisted intent).
 * Whether that preference is renderable depends on two pieces of
 * runtime truth owned by other layers:
 *  - `hasWorktree` for the selected branch (repo data)
 *  - `terminalSessionCount` + `terminalSyncReady` from the
 *    TerminalSessionRegistry (live terminal context)
 *
 * `syncReady` lets us avoid briefly flashing `status → terminal → status`
 * during boot: until the registry confirms the worktree truth, a
 * `terminal` preference is preserved. Once the first sync settles, an
 * empty worktree dismisses the `terminal` preference.
 *
 * Pure function so it can be unit-tested without React.
 */
export function computeEffectiveDetailTab(
  preferred: DetailTab,
  hasWorktree: boolean,
  terminalSessionCount: number,
  terminalSyncReady: boolean,
  terminalPendingCreate = false,
): DetailTab {
  if (!hasWorktree) return detailTabForWorktree(preferred, hasWorktree)
  if (preferred !== 'terminal') return preferred
  if (!terminalSyncReady) return 'terminal'
  return terminalSessionCount > 0 || terminalPendingCreate ? 'terminal' : 'status'
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
