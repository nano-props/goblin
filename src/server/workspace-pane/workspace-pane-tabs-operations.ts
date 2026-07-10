import {
  isWorkspacePaneRuntimeTabEntry,
  type WorkspacePaneRuntimeTabType,
  type WorkspacePaneStaticTabType,
  type WorkspacePaneTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneRuntimeTabSessionId,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabsInsertAfterIdentity,
  workspacePaneTabsMoveEntryAfterIdentity,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsUpdateOperation } from '#/shared/workspace-pane-tabs.ts'

export function workspacePaneTabsWithRuntimeTab(
  current: readonly WorkspacePaneTabEntry[],
  type: WorkspacePaneRuntimeTabType,
  sessionId: string,
  options?: { insertAfterIdentity?: string | null },
): WorkspacePaneTabEntry[] {
  if (sessionId.length === 0) return [...current]
  const existingIndex = current.findIndex(
    (entry) =>
      isWorkspacePaneRuntimeTabEntry(entry) &&
      entry.type === type &&
      workspacePaneRuntimeTabSessionId(entry) === sessionId,
  )
  if (existingIndex !== -1) {
    return workspacePaneTabsMoveEntryAfterIdentity(current, existingIndex, options?.insertAfterIdentity)
  }
  return workspacePaneTabsInsertAfterIdentity(
    current,
    workspacePaneRuntimeTabEntry(type, sessionId),
    options?.insertAfterIdentity,
  )
}

export function workspacePaneTabsWithUpdateOperation(
  current: readonly WorkspacePaneTabEntry[],
  operation: WorkspacePaneTabsUpdateOperation,
): WorkspacePaneTabEntry[] {
  switch (operation.type) {
    case 'open-static':
      return workspacePaneTabsWithStaticTab(current, operation.tabType, {
        insertAfterIdentity: operation.insertAfterIdentity,
      })
    case 'open-runtime':
      return workspacePaneTabsWithRuntimeTab(current, operation.runtimeType, operation.sessionId, {
        insertAfterIdentity: operation.insertAfterIdentity,
      })
    case 'close-static':
      return workspacePaneTabsWithoutStaticTab(current, operation.tabType)
    case 'reorder':
      return workspacePaneTabsWithIdentityOrder(current, operation.tabIdentities)
  }
}

export function workspacePaneTabsWithStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tabType: WorkspacePaneStaticTabType,
  options?: { insertAfterIdentity?: string | null },
): WorkspacePaneTabEntry[] {
  // Reopening an existing static tab should preserve the current user-managed
  // order and simply focus that tab on the client side.
  if (current.some((entry) => entry.type === tabType)) return [...current]
  return workspacePaneTabsInsertAfterIdentity(
    current,
    workspacePaneStaticTabEntry(tabType),
    options?.insertAfterIdentity,
  )
}

export function workspacePaneTabsWithoutStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tabType: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  return current.filter((entry) => entry.type !== tabType)
}

export function workspacePaneTabsWithIdentityOrder(
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

export function workspacePaneTabEntryArraysEqual(
  a: readonly WorkspacePaneTabEntry[],
  b: readonly WorkspacePaneTabEntry[],
): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    const current = a[index]
    const next = b[index]
    if (!current || !next) return false
    if (workspacePaneTabEntryIdentity(current) !== workspacePaneTabEntryIdentity(next)) return false
  }
  return true
}
