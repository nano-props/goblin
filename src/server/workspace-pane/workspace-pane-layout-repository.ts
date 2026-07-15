import type { RepoSessionEntry } from '#/shared/remote-repo.ts'
import {
  isWorkspacePaneRuntimeTabEntry,
  workspacePaneTabEntryIdentity,
  workspacePaneTabRequiresWorktree,
  workspacePaneStaticTabEntry,
  type WorkspacePaneStaticTabEntry,
} from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneDurableLayout,
  WorkspacePaneDurableLayoutEntry,
} from '#/shared/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneLayoutRepositorySnapshot {
  layout: WorkspacePaneDurableLayout
}

export type WorkspacePaneLayoutRepositoryCasOutcome =
  | { kind: 'accepted'; snapshot: WorkspacePaneLayoutRepositorySnapshot; changed: boolean }
  | { kind: 'conflict'; snapshot: WorkspacePaneLayoutRepositorySnapshot }
  | { kind: 'membership-conflict'; snapshot: WorkspacePaneLayoutRepositorySnapshot }

export interface WorkspacePaneLayoutRepositoryCasInput {
  repoRoot: string
  expected: WorkspacePaneDurableLayout
  replacement: WorkspacePaneDurableLayout
  expectedRepoEntry?: RepoSessionEntry
}

export interface WorkspacePaneLayoutRepository {
  load(repoRoot: string): Promise<WorkspacePaneLayoutRepositorySnapshot>
  compareAndSwap(input: WorkspacePaneLayoutRepositoryCasInput): Promise<WorkspacePaneLayoutRepositoryCasOutcome>
}

export function normalizeWorkspacePaneDurableLayout(
  repoRoot: string,
  layout: WorkspacePaneDurableLayout,
): WorkspacePaneDurableLayout {
  const byTarget = new Map<string, WorkspacePaneDurableLayoutEntry>()
  for (const entry of layout.entries) {
    if (entry.repoRoot !== repoRoot) continue
    const tabs: WorkspacePaneStaticTabEntry[] = []
    const seen = new Set<string>()
    for (const tab of entry.tabs) {
      if (isWorkspacePaneRuntimeTabEntry(tab)) continue
      if (entry.worktreePath === null && workspacePaneTabRequiresWorktree(tab.type)) continue
      const identity = workspacePaneTabEntryIdentity(tab)
      if (seen.has(identity)) continue
      seen.add(identity)
      tabs.push(workspacePaneStaticTabEntry(tab.type))
    }
    byTarget.set(workspacePaneTabsTargetIdentityKey(entry), {
      repoRoot,
      branchName: entry.branchName,
      worktreePath: entry.worktreePath,
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
  repoRoot: string,
  a: WorkspacePaneDurableLayout,
  b: WorkspacePaneDurableLayout,
): boolean {
  return JSON.stringify(normalizeWorkspacePaneDurableLayout(repoRoot, a)) ===
    JSON.stringify(normalizeWorkspacePaneDurableLayout(repoRoot, b))
}
