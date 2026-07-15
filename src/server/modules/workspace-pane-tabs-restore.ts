import type { ProjectedRestoredWorkspaceRepoRuntime, ServerWorkspaceState } from '#/shared/api-types.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { ServerWorkspaceMatchOutcome } from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

interface WorkspacePaneTabsRestoreInput {
  userId: string
  clientId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

export async function projectWorkspacePaneTabsWithMembershipGuard(input: {
  restoreInput: WorkspacePaneTabsRestoreInput
  workspace: ServerWorkspaceState
  repos: ProjectedRestoredWorkspaceRepoRuntime[]
  confirmMembership: () => Promise<ServerWorkspaceMatchOutcome>
  assertCurrent?: () => void
}): Promise<
  | {
      matched: true
      snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>
    }
  | { matched: false; latestWorkspace: ServerWorkspaceState }
> {
  const confirmed = await input.confirmMembership()
  if (!confirmed.matched) return confirmed
  input.restoreInput.signal?.throwIfAborted()
  const snapshots = await restoreWorkspacePaneTabsForRepos(input.restoreInput, input.repos)
  input.assertCurrent?.()
  input.restoreInput.signal?.throwIfAborted()
  const committed = await input.confirmMembership()
  if (!committed.matched) return committed
  return { matched: true, snapshots }
}

async function restoreWorkspacePaneTabsForRepos(
  input: WorkspacePaneTabsRestoreInput,
  repos: ProjectedRestoredWorkspaceRepoRuntime[],
) {
  const snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }> = []
  for (const repo of repos) {
    input.signal?.throwIfAborted()
    const targets = (repo.projection.snapshot?.branches ?? []).map((branch) => ({
      repoRoot: repo.repoRoot,
      branchName: branch.name,
      worktreePath: branch.worktree?.path ?? null,
    }))
    const snapshot = await input.workspacePaneTabsHost.restoreTabs(input.userId, {
      repoRoot: repo.repoRoot,
      repoRuntimeId: repo.repoRuntimeId,
      expectedRepoEntry: repo.entry,
      targets,
    })
    snapshots.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, snapshot })
  }
  return snapshots
}

export function workspaceRepoEntry(workspace: ServerWorkspaceState, repoRoot: string) {
  return workspace.openRepoEntries.find((entry) => repoSessionEntryId(entry) === repoRoot) ?? null
}
