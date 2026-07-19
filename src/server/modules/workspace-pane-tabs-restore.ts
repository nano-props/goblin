import type { RestoredWorkspaceRuntime, ServerWorkspaceState } from '#/shared/api-types.ts'
import { workspaceSessionEntryId, type WorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import { formatWorkspaceLocator, parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
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
  workspaces: RestoredWorkspaceRuntime[]
  confirmMembership: () => Promise<ServerWorkspaceMatchOutcome>
  membershipPolicy: 'transaction-authoritative' | 'confirm-after-restore'
  assertCurrent?: () => void
}): Promise<
  | {
      matched: true
      snapshots: Array<{ workspaceId: WorkspaceId; workspaceRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }>
      repaired: boolean
    }
  | { matched: false; latestWorkspace: ServerWorkspaceState }
> {
  input.restoreInput.signal?.throwIfAborted()
  for (;;) {
    const restored = await restoreWorkspacePaneTabsForWorkspaces(input.restoreInput, input.workspaces)
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

async function restoreWorkspacePaneTabsForWorkspaces(
  input: WorkspacePaneTabsRestoreInput,
  workspaces: RestoredWorkspaceRuntime[],
) {
  const snapshots: Array<{
    workspaceId: WorkspaceId
    workspaceRuntimeId: string
    snapshot: WorkspacePaneTabsSnapshot
  }> = []
  let repaired = false
  for (const workspace of workspaces) {
    input.signal?.throwIfAborted()
    const targets = restorableTargetsForWorkspace(workspace)
    if (!targets) continue
    const result = await input.workspacePaneTabsHost.restoreTabs(input.userId, {
      workspaceId: workspace.workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      expectedWorkspaceEntry: workspace.entry,
      targets,
    })
    if (result.kind === 'membership-conflict') return result
    snapshots.push({
      workspaceId: workspace.workspaceId,
      workspaceRuntimeId: workspace.workspaceRuntimeId,
      snapshot: result.snapshot,
    })
    if (result.repaired) repaired = true
  }
  return { kind: 'restored' as const, snapshots, repaired }
}

function restorableTargetsForWorkspace(workspace: RestoredWorkspaceRuntime) {
  if (workspace.workspaceProbe.status !== 'ready') return null
  if (workspace.projection) {
    const gitTargets = (workspace.projection.snapshot?.branches ?? []).flatMap((branch) => {
      const target: RestorableWorkspacePaneTarget | null = branch.worktree
        ? restorableWorktreeTarget(workspace.workspaceId, branch.worktree.path)
        : { kind: 'git-branch', branch: branch.name }
      return target ? [target] : []
    })
    return [{ kind: 'workspace-root' as const }, ...gitTargets]
  }
  return [{ kind: 'workspace-root' as const }]
}

function restorableWorktreeTarget(workspaceId: WorkspaceId, nativePath: string): RestorableWorkspacePaneTarget | null {
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

export function workspaceEntry(workspace: ServerWorkspaceState, workspaceId: WorkspaceId) {
  return workspace.openWorkspaceEntries.find((entry) => workspaceSessionEntryId(entry) === workspaceId) ?? null
}
