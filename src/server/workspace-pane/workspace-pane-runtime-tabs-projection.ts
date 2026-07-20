import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import { restorableWorkspacePaneTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'

export interface WorkspacePaneRuntimeTabsProviderSnapshot {
  type: WorkspacePaneRuntimeTabType
  revision: number
  liveSessions: readonly WorkspacePaneRuntimeTabsProviderSnapshotSession[]
}

export interface WorkspacePaneRuntimeTabsProviderSnapshotSession {
  sessionId: string
  target: RuntimeWorkspacePaneTarget
  branch: string | null
  worktreePath: string
}

export function workspaceRuntimeTabWorktreePaths(input: {
  entries: readonly WorkspacePaneTabsEntry[]
  providerSnapshots: readonly WorkspacePaneRuntimeTabsProviderSnapshot[]
}): string[] {
  const worktreePaths = new Set<string>()
  for (const entry of input.entries) {
    if (!restorableWorkspacePaneTargetFromRuntime(entry.target)) {
      throw new Error('error.workspace-tabs-target-invalid')
    }
    if (entry.target.kind !== 'git-worktree') continue
    const root = parseCanonicalWorkspaceLocator(entry.target.root)
    if (!root) throw new Error('error.workspace-tabs-target-invalid')
    worktreePaths.add(root.path)
  }
  for (const snapshot of input.providerSnapshots) {
    for (const session of snapshot.liveSessions) worktreePaths.add(session.worktreePath)
  }
  return [...worktreePaths]
}
