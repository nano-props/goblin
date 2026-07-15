import type { ProjectedRestoredWorkspaceRepoRuntime, ServerWorkspaceState } from '#/shared/api-types.ts'
import { repoSessionEntryId, sameRepoSessionEntry, type RepoSessionEntry } from '#/shared/remote-repo.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabsSnapshot } from '#/shared/workspace-pane-tabs.ts'
import {
  parseWorkspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import {
  clearServerWorkspaceTabsIfUnchanged,
  confirmServerWorkspaceTabsUnchanged,
  type ServerWorkspaceMatchOutcome,
} from '#/server/modules/settings-source.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

const MAX_WORKSPACE_REPAIR_CONFLICT_RETRIES = 3

interface WorkspacePaneTabsRestoreInput {
  userId: string
  clientId: string
  workspacePaneTabsHost: ServerWorkspacePaneTabsHost
  signal?: AbortSignal
}

export async function validateOrRepairWorkspacePaneTabs(
  initialWorkspace: ServerWorkspaceState,
  repo: ProjectedRestoredWorkspaceRepoRuntime,
  expectedRepoEntry: RepoSessionEntry,
): Promise<
  | { kind: 'validated'; workspace: ServerWorkspaceState; repaired: boolean }
  | { kind: 'membership-conflict'; latestWorkspace: ServerWorkspaceState }
> {
  let workspace = initialWorkspace
  for (let conflicts = 0; ; conflicts += 1) {
    const currentEntry = workspaceRepoEntry(workspace, repo.repoRoot)
    if (!sameRepoSessionEntry(currentEntry, expectedRepoEntry)) {
      return { kind: 'membership-conflict', latestWorkspace: workspace }
    }
    const repoWorkspace = workspaceForRepoTabs(workspace, repo.repoRoot)
    const expectedTabsByTarget = repoWorkspace.workspacePaneTabsByTargetByRepo[repo.repoRoot] ?? {}
    if (validateWorkspacePaneTabs(repoWorkspace, [repo])) {
      const confirmed = await confirmServerWorkspaceTabsUnchanged({
        repoRoot: repo.repoRoot,
        expectedRepoEntry,
        expectedTabsByTarget,
      })
      if (confirmed.matched) return { kind: 'validated', workspace: confirmed.workspace, repaired: false }
      if (conflicts >= MAX_WORKSPACE_REPAIR_CONFLICT_RETRIES) {
        throw new Error('workspace tabs validation was superseded too many times')
      }
      workspace = confirmed.latestWorkspace
      continue
    }
    const cleared = await clearServerWorkspaceTabsIfUnchanged({
      repoRoot: repo.repoRoot,
      expectedRepoEntry,
      expectedTabsByTarget,
    })
    if (cleared.cleared) return { kind: 'validated', workspace: cleared.workspace, repaired: true }
    if (conflicts >= MAX_WORKSPACE_REPAIR_CONFLICT_RETRIES) {
      throw new Error('workspace tabs repair was superseded too many times')
    }
    workspace = cleared.latestWorkspace
  }
}

export async function initializeWorkspacePaneTabsWithMembershipGuard(input: {
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
  const stableWorkspace = { ...input.workspace, openRepoEntries: confirmed.workspace.openRepoEntries }
  input.restoreInput.signal?.throwIfAborted()
  const snapshots = await restoreWorkspacePaneTabsForRepos(input.restoreInput, stableWorkspace, input.repos)
  input.assertCurrent?.()
  input.restoreInput.signal?.throwIfAborted()
  const committed = await input.confirmMembership()
  if (!committed.matched) return committed
  return { matched: true, snapshots }
}

function validateWorkspacePaneTabs(
  workspace: ServerWorkspaceState,
  repos: ProjectedRestoredWorkspaceRepoRuntime[],
): boolean {
  const reposByRoot = new Map(repos.map((repo) => [repo.repoRoot, repo]))
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = reposByRoot.get(repoRoot)
    if (!repo) continue
    for (const targetKey of Object.keys(tabsByTarget)) {
      if (!targetForWorkspaceKey(repo, targetKey)) return false
    }
  }
  return true
}

async function restoreWorkspacePaneTabsForRepos(
  input: WorkspacePaneTabsRestoreInput,
  workspace: ServerWorkspaceState,
  repos: ProjectedRestoredWorkspaceRepoRuntime[],
) {
  const replacements = workspacePaneTabRestoreReplacements(workspace, repos)
  const snapshots: Array<{ repoRoot: string; repoRuntimeId: string; snapshot: WorkspacePaneTabsSnapshot }> = []
  for (const repo of repos) {
    input.signal?.throwIfAborted()
    const snapshot = await input.workspacePaneTabsHost.initializeTabs(input.userId, {
      repoRoot: repo.repoRoot,
      repoRuntimeId: repo.repoRuntimeId,
      entries: replacements
        .filter((item) => item.repoRoot === repo.repoRoot)
        .map(({ target, tabs }) => ({ ...target, tabs })),
    })
    snapshots.push({ repoRoot: repo.repoRoot, repoRuntimeId: repo.repoRuntimeId, snapshot })
  }
  return snapshots
}

function workspacePaneTabRestoreReplacements(
  workspace: ServerWorkspaceState,
  repos: ProjectedRestoredWorkspaceRepoRuntime[],
): Array<{ repoRoot: string; target: WorkspacePaneTabsTarget; tabs: WorkspacePaneTabEntry[] }> {
  const reposByRoot = new Map(repos.map((repo) => [repo.repoRoot, repo]))
  const replacements = []
  for (const [repoRoot, tabsByTarget] of Object.entries(workspace.workspacePaneTabsByTargetByRepo)) {
    const repo = reposByRoot.get(repoRoot)
    if (!repo) continue
    for (const [targetKey, tabs] of Object.entries(tabsByTarget)) {
      const target = targetForWorkspaceKey(repo, targetKey)
      if (target) replacements.push({ repoRoot, target, tabs })
    }
  }
  return replacements
}

function targetForWorkspaceKey(repo: ProjectedRestoredWorkspaceRepoRuntime, targetKey: string) {
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.repoRoot !== repo.repoRoot) return null
  const branches = repo.projection.snapshot?.branches ?? []
  if (target.kind === 'branch') {
    return branches.some((branch) => branch.name === target.branchName)
      ? { repoRoot: repo.repoRoot, branchName: target.branchName, worktreePath: null }
      : null
  }
  const branch = branches.find((candidate) => candidate.worktree?.path === target.worktreePath)
  return branch ? { repoRoot: repo.repoRoot, branchName: branch.name, worktreePath: target.worktreePath } : null
}

export function workspaceRepoEntry(workspace: ServerWorkspaceState, repoRoot: string) {
  return workspace.openRepoEntries.find((entry) => repoSessionEntryId(entry) === repoRoot) ?? null
}

function workspaceForRepoTabs(workspace: ServerWorkspaceState, repoRoot: string): ServerWorkspaceState {
  return {
    openRepoEntries: workspace.openRepoEntries,
    workspacePaneTabsByTargetByRepo: { [repoRoot]: workspace.workspacePaneTabsByTargetByRepo[repoRoot] ?? {} },
  }
}
