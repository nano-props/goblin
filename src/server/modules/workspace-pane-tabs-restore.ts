import type { RestoredWorkspaceRepoRuntime, ServerWorkspaceState } from '#/shared/api-types.ts'
import { workspaceSessionEntryId, type WorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { formatWorkspaceLocator, parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
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
  repos: RestoredWorkspaceRepoRuntime[]
  confirmMembership: () => Promise<ServerWorkspaceMatchOutcome>
  membershipPolicy: 'transaction-authoritative' | 'confirm-after-restore'
  assertCurrent?: () => void
}): Promise<
  | {
      matched: true
      snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>
      repaired: boolean
    }
  | { matched: false; latestWorkspace: ServerWorkspaceState }
> {
  input.restoreInput.signal?.throwIfAborted()
  for (;;) {
    const restored = await restoreWorkspacePaneTabsForRepos(input.restoreInput, input.repos)
    if (restored.kind === 'restored') {
      input.assertCurrent?.()
      input.restoreInput.signal?.throwIfAborted()
      if (input.membershipPolicy === 'confirm-after-restore') {
        const committed = await input.confirmMembership()
        if (!committed.matched) return committed
      }
      return { matched: true, snapshots: restored.snapshots, repaired: restored.repaired }
    }
    const latest = await input.confirmMembership()
    if (!latest.matched) return latest
  }
}

async function restoreWorkspacePaneTabsForRepos(
  input: WorkspacePaneTabsRestoreInput,
  repos: RestoredWorkspaceRepoRuntime[],
) {
  const snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }> = []
  let repaired = false
  for (const repo of repos) {
    input.signal?.throwIfAborted()
    const targets = restorableTargetsForRepo(repo)
    if (!targets) continue
    const result = await input.workspacePaneTabsHost.restoreTabs(input.userId, {
      workspaceId: repo.repoRoot,
      workspaceRuntimeId: repo.repoRuntimeId,
      expectedRepoEntry: repo.entry,
      targets,
    })
    if (result.kind === 'membership-conflict') return result
    snapshots.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, snapshot: result.snapshot })
    if (result.repaired) repaired = true
  }
  return { kind: 'restored' as const, snapshots, repaired }
}

function restorableTargetsForRepo(repo: RestoredWorkspaceRepoRuntime) {
  if (repo.workspaceProbe.status !== 'ready') return null
  if (repo.projection) {
    const gitTargets = (repo.projection.snapshot?.branches ?? []).flatMap((branch) => {
      const target: RestorableWorkspacePaneTarget | null = branch.worktree
        ? restorableWorktreeTarget(repo.repoRoot, branch.worktree.path)
        : { kind: 'git-branch', branch: branch.name }
      return target ? [target] : []
    })
    return [{ kind: 'workspace-root' as const }, ...gitTargets]
  }
  return [{ kind: 'workspace-root' as const }]
}

function restorableWorktreeTarget(workspaceId: string, nativePath: string): RestorableWorkspacePaneTarget | null {
  const workspace = parseCanonicalWorkspaceLocator(workspaceId)
  if (!workspace) return null
  const root = formatWorkspaceLocator(
    workspace.transport === 'ssh'
      ? { transport: 'ssh', profile: workspace.profile, path: nativePath }
      : { transport: 'file', platform: workspace.platform, path: nativePath },
    workspace.transport === 'file' ? workspace.platform : 'posix',
  )
  return root ? { kind: 'git-worktree', root } : null
}

export function workspaceRepoEntry(workspace: ServerWorkspaceState, repoRoot: string) {
  return workspace.openWorkspaceEntries.find((entry) => workspaceSessionEntryId(entry) === repoRoot) ?? null
}
