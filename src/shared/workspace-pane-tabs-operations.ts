import {
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabsInsertAfterIdentity,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsUpdateOperation } from '#/shared/workspace-pane-tabs.ts'

export function workspacePaneTabsWithUpdateOperation(
  current: readonly WorkspacePaneTabEntry[],
  operation: WorkspacePaneTabsUpdateOperation,
): WorkspacePaneTabEntry[] {
  switch (operation.type) {
    case 'open-static':
      return workspacePaneTabsWithStaticTab(current, operation.tabType, {
        insertAfterIdentity: operation.insertAfterIdentity,
      })
    case 'close-static':
      return workspacePaneTabsWithoutStaticTab(current, operation.tabType)
    case 'reorder':
      return workspacePaneTabsWithIdentityOrder(current, operation.tabIdentities)
  }
}

function workspacePaneTabsWithStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tabType: WorkspacePaneStaticTabType,
  options?: { insertAfterIdentity?: string | null },
): WorkspacePaneTabEntry[] {
  if (current.some((entry) => entry.type === tabType)) return [...current]
  return workspacePaneTabsInsertAfterIdentity(
    current,
    workspacePaneStaticTabEntry(tabType),
    options?.insertAfterIdentity,
  )
}

function workspacePaneTabsWithoutStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tabType: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  return current.filter((entry) => entry.type !== tabType)
}

function workspacePaneTabsWithIdentityOrder(
  currentTabs: readonly WorkspacePaneTabEntry[],
  tabIdentities: readonly string[],
): WorkspacePaneTabEntry[] {
  const tabByIdentity = new Map(currentTabs.map((tab) => [workspacePaneTabEntryIdentity(tab), tab]))
  const used = new Set<string>()
  const ordered: WorkspacePaneTabEntry[] = []
  for (const identity of tabIdentities) {
    const tab = tabByIdentity.get(identity)
    if (!tab || used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  for (const tab of currentTabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    if (used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  return ordered
}
