import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryFromUnknown,
  workspacePaneTabEntryIdentity,
  workspacePaneTabsInsertAfterIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'

const DEFAULT_WORKSPACE_PANE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export function defaultWorkspacePaneTabs(): WorkspacePaneTabEntry[] {
  return [...DEFAULT_WORKSPACE_PANE_TABS]
}

export function workspacePaneStaticTabsFromEntries(
  tabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneStaticTabType[] {
  return normalizeWorkspacePaneTabs(tabs).flatMap((entry) =>
    isWorkspacePaneRuntimeTabEntry(entry) ? [] : [entry.type],
  )
}

export function workspacePaneTabsWithStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tab: WorkspacePaneStaticTabType,
  options?: { insertAfterIdentity?: string | null },
): WorkspacePaneTabEntry[] {
  // Reopening an already-open static tab should only focus it; we intentionally
  // do not reorder existing tabs from here.
  if (current.some((entry) => entry.type === tab)) return normalizeWorkspacePaneTabs(current)
  return normalizeWorkspacePaneTabs(
    workspacePaneTabsInsertAfterIdentity(current, workspacePaneStaticTabEntry(tab), options?.insertAfterIdentity),
  )
}

export function workspacePaneTabsWithoutStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  return normalizeWorkspacePaneTabs(current.filter((entry) => entry.type !== tab))
}

export function orderWorkspacePaneItemsByTabEntries<T>(
  items: readonly T[],
  tabs: readonly WorkspacePaneTabEntry[],
  getTabEntry: (item: T) => WorkspacePaneTabEntry | null,
): T[] {
  const itemByIdentity = new Map<string, T>()
  const used = new Set<string>()
  const nonSortableItems: T[] = []

  for (const item of items) {
    const entry = getTabEntry(item)
    if (!entry) {
      nonSortableItems.push(item)
      continue
    }
    itemByIdentity.set(workspacePaneTabEntryIdentity(entry), item)
  }

  const orderedItems: T[] = []
  for (const tab of tabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    const item = itemByIdentity.get(identity)
    if (!item || used.has(identity)) continue
    used.add(identity)
    orderedItems.push(item)
  }

  for (const item of items) {
    const entry = getTabEntry(item)
    if (!entry) continue
    const identity = workspacePaneTabEntryIdentity(entry)
    if (used.has(identity)) continue
    used.add(identity)
    orderedItems.push(item)
  }

  return [...orderedItems, ...nonSortableItems]
}

export function workspacePaneTabsWithDraggedOrder(
  currentTabs: readonly WorkspacePaneTabEntry[],
  draggedTabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabEntry[] {
  return orderWorkspacePaneItemsByTabEntries(currentTabs, draggedTabs, (entry) => entry)
}

export function workspacePaneTabEntryListIdentity(tabs: readonly WorkspacePaneTabEntry[]): string {
  return tabs.map(workspacePaneTabEntryIdentity).join('\0')
}

export function normalizeWorkspacePaneTabs(
  tabs: readonly WorkspacePaneTabEntry[],
  context?: { hasWorktree?: boolean },
): WorkspacePaneTabEntry[] {
  const next: WorkspacePaneTabEntry[] = []
  const seen = new Set<string>()
  for (const raw of tabs) {
    const entry = workspacePaneTabEntryFromUnknown(raw)
    if (!entry) continue
    if (context?.hasWorktree === false && workspacePaneTabRequiresWorktree(entry.type)) continue
    const identity = workspacePaneTabEntryIdentity(entry)
    if (seen.has(identity)) continue
    seen.add(identity)
    next.push(entry)
  }
  return next
}
