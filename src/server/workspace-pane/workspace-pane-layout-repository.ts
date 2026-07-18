import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
  workspacePaneStaticTabEntry,
  type WorkspacePaneStaticTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneDurableLayout, WorkspacePaneDurableLayoutEntry } from '#/shared/workspace-pane-tabs.ts'
import {
  restorableWorkspacePaneTargetKey,
  workspacePaneTabsTargetFromRestorable,
} from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneLayoutRepositorySnapshot {
  layout: WorkspacePaneDurableLayout
}

export interface WorkspacePaneLayoutRepositoryAcceptedOutcome {
  kind: 'accepted'
  snapshot: WorkspacePaneLayoutRepositorySnapshot
  changed: boolean
}

export type WorkspacePaneLayoutRepositoryCasStateOutcome =
  WorkspacePaneLayoutRepositoryAcceptedOutcome | { kind: 'conflict'; snapshot: WorkspacePaneLayoutRepositorySnapshot }

export type WorkspacePaneLayoutRepositoryCasOutcome =
  WorkspacePaneLayoutRepositoryCasStateOutcome | { kind: 'write-failure'; error: unknown }

export interface WorkspacePaneLayoutRepositoryCasInput {
  workspaceId: string
  expected: WorkspacePaneDurableLayout
  replacement: WorkspacePaneDurableLayout
}

export interface WorkspacePaneLayoutRepository {
  load(workspaceId: string): Promise<WorkspacePaneLayoutRepositorySnapshot>
  compareAndSwap(input: WorkspacePaneLayoutRepositoryCasInput): Promise<WorkspacePaneLayoutRepositoryCasOutcome>
}

export function normalizeWorkspacePaneDurableLayout(
  workspaceId: string,
  layout: WorkspacePaneDurableLayout,
): WorkspacePaneDurableLayout {
  const byTarget = new Map<string, WorkspacePaneDurableLayoutEntry>()
  for (const entry of layout.entries) {
    if (!entry?.target || !Array.isArray(entry.tabs)) continue
    if (!workspacePaneTabsTargetFromRestorable(workspaceId, entry.target)) continue
    const tabs: WorkspacePaneStaticTabEntry[] = []
    const seen = new Set<string>()
    for (const tab of entry.tabs) {
      if (isWorkspacePaneRuntimeTabEntry(tab)) continue
      if (entry.target.kind === 'git-branch' && workspacePaneTabRequiresWorktree(tab.type)) continue
      const identity = workspacePaneTabEntryIdentity(tab)
      if (seen.has(identity)) continue
      seen.add(identity)
      tabs.push(workspacePaneStaticTabEntry(tab.type))
    }
    byTarget.set(restorableWorkspacePaneTargetKey(entry.target), {
      target: entry.target,
      tabs,
    })
  }
  return {
    entries: Array.from(byTarget.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, entry]) => entry),
  }
}

export function workspacePaneDurableLayoutsEqual(
  workspaceId: string,
  a: WorkspacePaneDurableLayout,
  b: WorkspacePaneDurableLayout,
): boolean {
  return (
    JSON.stringify(normalizeWorkspacePaneDurableLayout(workspaceId, a)) ===
    JSON.stringify(normalizeWorkspacePaneDurableLayout(workspaceId, b))
  )
}
