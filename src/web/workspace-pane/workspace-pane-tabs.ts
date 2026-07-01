import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  workspacePaneTabEntryFromUnknown,
  workspacePaneStaticTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'

const DEFAULT_WORKSPACE_PANE_TABS: readonly WorkspacePaneTabEntry[] = [workspacePaneStaticTabEntry('status')]

export function defaultWorkspacePaneTabs(): WorkspacePaneTabEntry[] {
  return [...DEFAULT_WORKSPACE_PANE_TABS]
}

export function workspacePaneStaticTabsFromEntries(
  tabs: readonly WorkspacePaneTabEntry[],
): WorkspacePaneStaticTabType[] {
  return normalizeWorkspacePaneTabs(tabs).flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}

export function workspacePaneTabsWithStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  if (current.some((entry) => entry.type === tab)) return normalizeWorkspacePaneTabs(current)
  return normalizeWorkspacePaneTabs([...current, workspacePaneStaticTabEntry(tab)])
}

export function workspacePaneTabsWithoutStaticTab(
  current: readonly WorkspacePaneTabEntry[],
  tab: WorkspacePaneStaticTabType,
): WorkspacePaneTabEntry[] {
  return normalizeWorkspacePaneTabs(current.filter((entry) => entry.type !== tab))
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
