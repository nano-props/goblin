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

/**
 * The runtime truth that determines which detail tab is renderable.
 * Grouped into an object so callers can't accidentally swap two
 * booleans at the call site.
 */
export interface DetailTabContext {
  /** Whether the selected branch has a worktree on disk. */
  hasWorktree: boolean
  /** Whether that worktree has uncommitted changes. */
  hasChanges: boolean
  /** Number of open terminal sessions for the worktree. */
  terminalSessionCount: number
  /** Whether the terminal session registry has finished its first sync. */
  terminalSyncReady: boolean
  /** True while a `create terminal` IPC is in flight. */
  terminalPendingCreate?: boolean
}

/**
 * The set of detail tabs the UI should offer for the selected branch.
 * The `changes` tab is hidden when the worktree is clean — there's
 * nothing to look at, and an empty list tab would just be noise.
 * `terminal` stays gated on `hasWorktree` for the same reason.
 */
export function visibleDetailTabs({ hasWorktree, hasChanges }: Pick<DetailTabContext, 'hasWorktree' | 'hasChanges'>) {
  return DETAIL_TABS.filter((tab) => {
    if (!hasWorktree && tab.id === 'terminal') return false
    if (!hasChanges && tab.id === 'changes') return false
    return true
  })
}

export function detailTabForWorktree(tab: DetailTab, hasWorktree: boolean): DetailTab {
  if (tab === 'terminal') return hasWorktree ? tab : 'status'
  return tab
}

/**
 * Resolve the detail tab the UI should actually render.
 *
 * The repos store holds the user's *preferred* tab (the persisted intent).
 * Whether that preference is renderable depends on the live context:
 *  - `hasWorktree` and `hasChanges` describe the worktree (repo data)
 *  - `terminalSessionCount` + `terminalSyncReady` come from the
 *    TerminalSessionRegistry (live terminal context)
 *
 * `syncReady` lets us avoid briefly flashing `status → terminal → status`
 * during boot: until the registry confirms the worktree truth, a
 * `terminal` preference is preserved. Once the first sync settles, an
 * empty worktree dismisses the `terminal` preference.
 *
 * A `changes` preference with no current changes is routed to `status`
 * so the user always sees meaningful content; the persisted preference
 * is preserved, so the changes tab reappears (and re-selects) as soon
 * as something is dirty again.
 *
 * Pure function so it can be unit-tested without React.
 */
export function computeEffectiveDetailTab(preferred: DetailTab, context: DetailTabContext): DetailTab {
  if (!context.hasWorktree) return detailTabForWorktree(preferred, context.hasWorktree)
  if (preferred === 'changes' && !context.hasChanges) return 'status'
  if (preferred !== 'terminal') return preferred
  if (!context.terminalSyncReady) return 'terminal'
  return context.terminalSessionCount > 0 || context.terminalPendingCreate ? 'terminal' : 'status'
}

export function detailTabNavigationKey(key: string): DetailTabNavigationKey | null {
  return key === 'ArrowRight' || key === 'ArrowLeft' || key === 'Home' || key === 'End' ? key : null
}

// Shared by the ARIA tablist handler and global shortcuts; callers own focus and collapse side effects.
export function navigatedDetailTab(
  current: DetailTab,
  key: DetailTabNavigationKey,
  hasWorktree: boolean,
  hasChanges: boolean,
): DetailTab {
  const tabs = visibleDetailTabs({ hasWorktree, hasChanges })
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

export function adjacentDetailTab(
  current: DetailTab,
  direction: 1 | -1,
  hasWorktree: boolean,
  hasChanges: boolean,
): DetailTab {
  return navigatedDetailTab(current, direction === 1 ? 'ArrowRight' : 'ArrowLeft', hasWorktree, hasChanges)
}
