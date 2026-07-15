import type { ProjectedRestoredWorkspaceRepoRuntime, ServerWorkspaceState } from '#/shared/api-types.ts'
import { repoSessionEntryId, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import type { ServerWorkspaceMatchOutcome } from '#/server/modules/settings-source.ts'
import type {
  ServerWorkspacePaneTabsHost,
  WorkspacePaneTabsRestoreResult,
} from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

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
  for (;;) {
    const restored = await restoreWorkspacePaneTabsForRepos(input.restoreInput, input.repos)
    if (restored.kind === 'restored') {
      input.assertCurrent?.()
      input.restoreInput.signal?.throwIfAborted()
      const committed = await input.confirmMembership()
      if (!committed.matched) return committed
      return { matched: true, snapshots: restored.snapshots }
    }
    const latest = await input.confirmMembership()
    if (!latest.matched) return latest
  }
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
    const result = await input.workspacePaneTabsHost.restoreTabs(input.userId, {
      repoRoot: repo.repoRoot,
      repoRuntimeId: repo.repoRuntimeId,
      expectedRepoEntry: repo.entry,
      targets,
    })
    if (isMembershipConflict(result)) return result
    snapshots.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, snapshot: result })
  }
  return { kind: 'restored' as const, snapshots }
}

function isMembershipConflict(
  result: WorkspacePaneTabsRestoreResult,
): result is Extract<WorkspacePaneTabsRestoreResult, { kind: 'membership-conflict' }> {
  return 'kind' in result && result.kind === 'membership-conflict'
}

export function workspaceRepoEntry(workspace: ServerWorkspaceState, repoRoot: string) {
  return workspace.openRepoEntries.find((entry) => repoSessionEntryId(entry) === repoRoot) ?? null
}
