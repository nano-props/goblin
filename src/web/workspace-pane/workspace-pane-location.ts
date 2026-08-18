import { gitHeadBranch, type GitHead } from '#/shared/git-head.ts'
import { repoWorktreeMaterializedBranch, type WorkspaceRepoWorktreeSnapshot } from '#/shared/git-types.ts'
import {
  requiredGitWorkspacePaneTabsTarget,
  gitWorktreeWorkspacePaneTabsTarget,
  workspacePaneTabsLayoutTargetForWorktree,
  type GitBranchWorkspacePaneTabsTarget,
  type GitWorktreeWorkspacePaneTabsTarget,
  type RootWorkspacePaneTabsTarget,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  gitWorktreeFilesystemExecutionTarget,
  workspaceRootFilesystemExecutionTarget,
  type WorkspaceCapabilities,
  type WorkspaceGitReadyProbeState,
  type WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import {
  gitWorktreePaneFilesystemTarget,
  workspaceRootPaneFilesystemTarget,
  type WorkspacePaneFilesystemTarget,
} from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'

interface WorkspacePaneLocationBase {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  routeTarget: WorkspacePaneTabsTarget
  paneTarget: WorkspacePaneTabsTarget
}

export interface WorkspaceRootPaneLocation extends WorkspacePaneLocationBase {
  kind: 'workspace-root'
  routeTarget: RootWorkspacePaneTabsTarget
  paneTarget: RootWorkspacePaneTabsTarget
  worktreeHead: null
  branchName: null
}

export interface SourceWorktreePaneLocation extends WorkspacePaneLocationBase {
  kind: 'source-worktree'
  routeTarget: GitWorktreeWorkspacePaneTabsTarget
  paneTarget: RootWorkspacePaneTabsTarget
  worktreeHead: GitHead
  branchName: string | null
}

export interface LinkedWorktreePaneLocation extends WorkspacePaneLocationBase {
  kind: 'linked-worktree'
  routeTarget: GitWorktreeWorkspacePaneTabsTarget
  paneTarget: GitWorktreeWorkspacePaneTabsTarget
  worktreeHead: GitHead
  branchName: string | null
}

export interface BranchPaneLocation extends WorkspacePaneLocationBase {
  kind: 'branch'
  routeTarget: GitBranchWorkspacePaneTabsTarget
  paneTarget: GitBranchWorkspacePaneTabsTarget
  worktreeHead: null
  branchName: string
}

export type WorkspacePaneLocation =
  WorkspaceRootPaneLocation | SourceWorktreePaneLocation | LinkedWorktreePaneLocation | BranchPaneLocation

export type FilesystemWorkspacePaneLocation = Exclude<WorkspacePaneLocation, BranchPaneLocation>

export function workspacePaneLocationForRoot(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
): WorkspaceRootPaneLocation {
  const target = { kind: 'workspace-root' as const, workspaceId }
  return {
    kind: 'workspace-root',
    workspaceId,
    workspaceRuntimeId,
    routeTarget: target,
    paneTarget: target,
    worktreeHead: null,
    branchName: null,
  }
}

export function workspacePaneLocationForBranch(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  branchName: string,
  worktree: WorkspaceRepoWorktreeSnapshot | null,
): WorkspacePaneLocation {
  const routeTarget = requiredGitWorkspacePaneTabsTarget(workspaceId, branchName, worktree?.path ?? null)
  if (!worktree) {
    if (routeTarget.kind !== 'git-branch') throw new Error('branch context requires a branch target')
    return {
      kind: 'branch',
      workspaceId,
      workspaceRuntimeId,
      routeTarget,
      paneTarget: routeTarget,
      worktreeHead: null,
      branchName,
    }
  }
  if (routeTarget.kind !== 'git-worktree') throw new Error('worktree context requires a worktree target')
  const materializedBranch = repoWorktreeMaterializedBranch(worktree)
  if (materializedBranch !== branchName) throw new Error('worktree context requires the materialized branch')
  return worktree.isSource
    ? {
        kind: 'source-worktree',
        workspaceId,
        workspaceRuntimeId,
        routeTarget,
        paneTarget: workspacePaneTabsLayoutTargetForWorktree(routeTarget, true),
        worktreeHead: worktree.head,
        branchName: materializedBranch,
      }
    : {
        kind: 'linked-worktree',
        workspaceId,
        workspaceRuntimeId,
        routeTarget,
        paneTarget: workspacePaneTabsLayoutTargetForWorktree(routeTarget, false),
        worktreeHead: worktree.head,
        branchName: materializedBranch,
      }
}

export function workspacePaneLocationForWorktree(
  workspaceId: WorkspaceId,
  workspaceRuntimeId: string,
  worktree: WorkspaceRepoWorktreeSnapshot,
): SourceWorktreePaneLocation | LinkedWorktreePaneLocation {
  const routeTarget = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktree.path)
  if (!routeTarget) throw new Error('worktree context requires canonical workspace coordinates')
  const branchName = repoWorktreeMaterializedBranch(worktree)
  return worktree.isSource
    ? {
        kind: 'source-worktree',
        workspaceId,
        workspaceRuntimeId,
        routeTarget,
        paneTarget: workspacePaneTabsLayoutTargetForWorktree(routeTarget, true),
        worktreeHead: worktree.head,
        branchName,
      }
    : {
        kind: 'linked-worktree',
        workspaceId,
        workspaceRuntimeId,
        routeTarget,
        paneTarget: workspacePaneTabsLayoutTargetForWorktree(routeTarget, false),
        worktreeHead: worktree.head,
        branchName,
      }
}

export function workspacePaneLocationForLinkedWorktree(
  routeTarget: GitWorktreeWorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
  worktreeHead: GitHead,
): LinkedWorktreePaneLocation {
  return {
    kind: 'linked-worktree',
    workspaceId: routeTarget.workspaceId,
    workspaceRuntimeId,
    routeTarget,
    paneTarget: routeTarget,
    worktreeHead,
    branchName: gitHeadBranch(worktreeHead),
  }
}

export function workspacePaneLocationForBranchTarget(
  routeTarget: GitBranchWorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
): BranchPaneLocation {
  return {
    kind: 'branch',
    workspaceId: routeTarget.workspaceId,
    workspaceRuntimeId,
    routeTarget,
    paneTarget: routeTarget,
    worktreeHead: null,
    branchName: routeTarget.branchName,
  }
}

export function workspacePaneLocationBranchName(location: WorkspacePaneLocation): string | null {
  return location.branchName
}

export function workspacePaneLocationWorktreePath(location: WorkspacePaneLocation): string | null {
  return location.routeTarget.kind === 'git-worktree' ? location.routeTarget.worktreePath : null
}

export function workspacePaneLocationSupportsTab(location: WorkspacePaneLocation, type: WorkspacePaneTabType): boolean {
  if (location.kind === 'workspace-root') {
    return type === 'status' || type === 'files' || type === 'terminal'
  }
  if (location.kind === 'branch') return type === 'status' || type === 'history'
  return true
}

/** Projects one canonical layout into the entries presentable on this location's surface. */
export function workspacePaneSurfaceTabEntries(
  location: WorkspacePaneLocation,
  entries: readonly WorkspacePaneTabEntry[],
): WorkspacePaneTabEntry[] {
  return entries.filter((entry) => workspacePaneLocationSupportsTab(location, entry.type))
}

export function workspacePaneLocationExecutionTarget(
  location: FilesystemWorkspacePaneLocation,
): WorkspacePaneFilesystemExecutionTarget {
  const target =
    location.paneTarget.kind === 'workspace-root'
      ? workspaceRootFilesystemExecutionTarget(location.workspaceId, location.workspaceRuntimeId)
      : gitWorktreeFilesystemExecutionTarget(
          location.workspaceId,
          location.workspaceRuntimeId,
          location.paneTarget.worktreePath,
        )
  if (!target) throw new Error('filesystem location requires canonical execution coordinates')
  return target
}

export function workspacePaneLocationTerminalBase(location: WorkspacePaneLocation): TerminalSessionBase | null {
  if (location.kind === 'branch') return null
  const target = workspacePaneLocationExecutionTarget(location)
  return target.kind === 'workspace-root'
    ? { target, presentation: { kind: 'workspace-root' } }
    : { target, presentation: { kind: 'git-worktree' } }
}

export function workspacePaneFilesystemTargetForLocation(
  location: WorkspaceRootPaneLocation,
  capabilities: WorkspaceCapabilities,
): WorkspacePaneFilesystemTarget
export function workspacePaneFilesystemTargetForLocation(
  location: SourceWorktreePaneLocation | LinkedWorktreePaneLocation,
  capabilities: WorkspaceGitReadyProbeState['capabilities'],
): WorkspacePaneFilesystemTarget
export function workspacePaneFilesystemTargetForLocation(
  location: FilesystemWorkspacePaneLocation,
  capabilities: WorkspaceCapabilities,
): WorkspacePaneFilesystemTarget {
  if (location.kind === 'workspace-root' || location.kind === 'source-worktree') {
    return workspaceRootPaneFilesystemTarget({
      workspaceId: location.workspaceId,
      workspaceRuntimeId: location.workspaceRuntimeId,
      capabilities,
    })
  }
  if (capabilities.git.status !== 'available') throw new Error('linked worktree requires Git capabilities')
  const gitCapabilities = { ...capabilities, git: capabilities.git }
  return gitWorktreePaneFilesystemTarget({
    workspaceId: location.workspaceId,
    workspaceRuntimeId: location.workspaceRuntimeId,
    worktreePath: location.paneTarget.worktreePath,
    head: location.worktreeHead,
    capabilities: gitCapabilities,
  })
}
