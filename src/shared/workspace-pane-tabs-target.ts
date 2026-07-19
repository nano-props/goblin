import type { RestorableWorkspacePaneTarget, RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { isValidBranch } from '#/shared/input-validation.ts'
import {
  canonicalWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  type WorkspaceId,
  workspaceLocatorForPath,
  workspaceLocatorsShareTransport,
} from '#/shared/workspace-locator.ts'

export interface GitBranchWorkspacePaneTabsTarget {
  kind: 'git-branch'
  workspaceId: WorkspaceId
  branchName: string
}

export interface GitWorktreeWorkspacePaneTabsTarget {
  kind: 'git-worktree'
  workspaceId: WorkspaceId
  worktreePath: string
}

export interface RootWorkspacePaneTabsTarget {
  kind: 'workspace-root'
  workspaceId: WorkspaceId
}

export type WorkspacePaneTabsTarget =
  RootWorkspacePaneTabsTarget | GitBranchWorkspacePaneTabsTarget | GitWorktreeWorkspacePaneTabsTarget

/** Returns a branch target's stable identity; this is never a worktree HEAD presentation. */
export function workspacePaneTabsBranchIdentity(target: WorkspacePaneTabsTarget): string | null {
  return target.kind === 'git-branch' ? target.branchName : null
}

export function workspacePaneTabsTargetWorktreePath(target: WorkspacePaneTabsTarget): string | null {
  return target.kind === 'git-worktree' ? target.worktreePath : null
}

export function gitWorktreeWorkspacePaneTabsTarget(
  workspaceId: WorkspaceId,
  worktreePath: string,
): GitWorktreeWorkspacePaneTabsTarget | null {
  const worktreeId = workspaceLocatorForPath(workspaceId, worktreePath)
  return worktreeId ? { kind: 'git-worktree', workspaceId, worktreePath } : null
}

export function gitWorkspacePaneTabsTarget(
  workspaceId: WorkspaceId,
  branchName: string,
  worktreePath: string | null,
): GitBranchWorkspacePaneTabsTarget | GitWorktreeWorkspacePaneTabsTarget | null {
  if (!isValidBranch(branchName)) return null
  return worktreePath === null
    ? { kind: 'git-branch', workspaceId, branchName }
    : gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
}

export function requiredGitWorkspacePaneTabsTarget(
  workspaceId: WorkspaceId,
  branchName: string,
  worktreePath: string | null,
): GitBranchWorkspacePaneTabsTarget | GitWorktreeWorkspacePaneTabsTarget {
  const target = gitWorkspacePaneTabsTarget(workspaceId, branchName, worktreePath)
  if (!target) throw new Error('workspace pane target requires canonical workspace coordinates')
  return target
}

export type WorkspacePaneTabsTargetIdentity =
  | {
      kind: 'workspace-root'
      workspaceId: WorkspaceId
    }
  | {
      kind: 'branch'
      workspaceId: WorkspaceId
      branchName: string
    }
  | {
      kind: 'worktree'
      workspaceId: WorkspaceId
      worktreeId: WorkspaceId
    }

export function workspacePaneTabsTargetIdentityKey(target: WorkspacePaneTabsTarget): string {
  return workspacePaneTabsTargetIdentityKeyFromIdentity(
    target.kind === 'git-branch'
      ? { kind: 'branch', workspaceId: target.workspaceId, branchName: target.branchName }
      : target.kind === 'git-worktree'
        ? worktreeTargetIdentity(target.workspaceId, target.worktreePath)
        : target,
  )
}

function worktreeTargetIdentity(
  workspaceId: WorkspaceId,
  worktreePath: string,
): Extract<WorkspacePaneTabsTargetIdentity, { kind: 'worktree' }> {
  const worktreeId = workspaceLocatorForPath(workspaceId, worktreePath)
  if (!worktreeId) {
    throw new Error('workspace pane target requires canonical workspace coordinates')
  }
  return { kind: 'worktree', workspaceId, worktreeId }
}

export function workspacePaneTabsTargetIdentityKeyFromIdentity(target: WorkspacePaneTabsTargetIdentity): string {
  const workspaceId = canonicalWorkspaceLocator(target.workspaceId)
  if (workspaceId !== target.workspaceId) throw new Error('workspace pane target requires a canonical workspace locator')
  if (target.kind === 'workspace-root') return `${workspaceId}\0workspace-root`
  if (target.kind === 'worktree') {
    if (
      canonicalWorkspaceLocator(target.worktreeId) !== target.worktreeId ||
      !workspaceLocatorsShareTransport(workspaceId, target.worktreeId)
    ) {
      throw new Error('workspace pane worktree target requires a compatible canonical locator')
    }
    return `${workspaceId}\0worktree\0${target.worktreeId}`
  }
  if (!isValidBranch(target.branchName)) throw new Error('workspace pane branch target requires a valid branch')
  return `${target.workspaceId}\0branch\0${target.branchName}`
}

export function parseWorkspacePaneTabsTargetIdentityKey(key: string): WorkspacePaneTabsTargetIdentity | null {
  const parts = key.split('\0')
  if (parts.length === 2 && parts[1] === 'workspace-root') {
    const workspaceId = canonicalWorkspaceLocator(parts[0])
    return workspaceId === parts[0] ? { kind: 'workspace-root', workspaceId } : null
  }
  if (parts.length !== 3) return null
  const [workspaceId, kind, value] = parts
  const canonicalWorkspaceId = canonicalWorkspaceLocator(workspaceId)
  if (canonicalWorkspaceId !== workspaceId || !value) return null
  if (kind === 'branch') {
    return isValidBranch(value) ? { kind, workspaceId: canonicalWorkspaceId, branchName: value } : null
  }
  if (kind === 'worktree') {
    const worktreeId = canonicalWorkspaceLocator(value)
    return worktreeId === value && workspaceLocatorsShareTransport(canonicalWorkspaceId, worktreeId)
      ? { kind, workspaceId: canonicalWorkspaceId, worktreeId }
      : null
  }
  return null
}

export function restorableWorkspacePaneTargetKey(target: RestorableWorkspacePaneTarget): string {
  if (target.kind === 'workspace-root') return 'workspace-root'
  if (target.kind === 'git-branch') return `git-branch\0${target.branch}`
  return `git-worktree\0${target.root}`
}

export function restorableWorkspacePaneTargetFromRuntime(
  target: RuntimeWorkspacePaneTarget,
): RestorableWorkspacePaneTarget | null {
  if (!target.workspaceId || !target.workspaceRuntimeId) return null
  if (target.kind === 'workspace-root') return { kind: 'workspace-root' }
  if (target.kind === 'git-branch') return target.branch ? { kind: 'git-branch', branch: target.branch } : null
  const workspace = parseCanonicalWorkspaceLocator(target.workspaceId)
  const root = parseCanonicalWorkspaceLocator(target.root)
  if (!workspace || !root || workspace.transport !== root.transport) return null
  if (workspace.transport === 'ssh' && (root.transport !== 'ssh' || workspace.profile !== root.profile)) return null
  return { kind: 'git-worktree', root: target.root }
}

export function runtimeWorkspacePaneTargetKey(target: RuntimeWorkspacePaneTarget): string | null {
  const restorable = restorableWorkspacePaneTargetFromRuntime(target)
  return restorable
    ? `${target.workspaceId}\0${target.workspaceRuntimeId}\0${restorableWorkspacePaneTargetKey(restorable)}`
    : null
}

export function parseRestorableWorkspacePaneTargetKey(key: string): RestorableWorkspacePaneTarget | null {
  if (key === 'workspace-root') return { kind: 'workspace-root' }
  const separator = key.indexOf('\0')
  if (separator < 0 || key.indexOf('\0', separator + 1) >= 0) return null
  const kind = key.slice(0, separator)
  const value = key.slice(separator + 1)
  if (!value) return null
  if (kind === 'git-branch') return { kind, branch: value }
  if (kind !== 'git-worktree') return null
  const root = canonicalWorkspaceLocator(value)
  return root === value ? { kind, root } : null
}

export function restorableWorkspacePaneTarget(target: WorkspacePaneTabsTarget): RestorableWorkspacePaneTarget | null {
  if (target.kind === 'workspace-root') return { kind: 'workspace-root' }
  if (target.kind === 'git-branch') return { kind: 'git-branch', branch: target.branchName }
  const identity = worktreeTargetIdentity(target.workspaceId, target.worktreePath)
  return { kind: 'git-worktree', root: identity.worktreeId }
}

export function workspacePaneTabsTargetFromRestorable(
  workspaceId: WorkspaceId,
  target: RestorableWorkspacePaneTarget,
): WorkspacePaneTabsTarget | null {
  if (target.kind === 'workspace-root') {
    return { kind: 'workspace-root', workspaceId: workspaceId }
  }
  if (target.kind === 'git-branch') {
    return { kind: 'git-branch', workspaceId: workspaceId, branchName: target.branch }
  }
  const root = parseCanonicalWorkspaceLocator(target.root)
  const workspace = parseCanonicalWorkspaceLocator(workspaceId)
  if (!root || !workspace || root.transport !== workspace.transport) return null
  if (root.transport === 'ssh' && (workspace.transport !== 'ssh' || root.profile !== workspace.profile)) return null
  return { kind: 'git-worktree', workspaceId: workspaceId, worktreePath: root.path }
}

export function workspacePaneTabsTargetFromRuntime(target: RuntimeWorkspacePaneTarget): WorkspacePaneTabsTarget | null {
  if (!target.workspaceId || !target.workspaceRuntimeId) return null
  if (target.kind === 'workspace-root') {
    return { kind: 'workspace-root', workspaceId: target.workspaceId }
  }
  if (target.kind === 'git-branch') {
    return target.branch ? { kind: 'git-branch', workspaceId: target.workspaceId, branchName: target.branch } : null
  }
  const workspace = parseCanonicalWorkspaceLocator(target.workspaceId)
  const root = parseCanonicalWorkspaceLocator(target.root)
  if (!workspace || !root || workspace.transport !== root.transport) return null
  if (workspace.transport === 'ssh' && (root.transport !== 'ssh' || workspace.profile !== root.profile)) return null
  return { kind: 'git-worktree', workspaceId: target.workspaceId, worktreePath: root.path }
}

export function runtimeWorkspacePaneTarget(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
): RuntimeWorkspacePaneTarget | null {
  const workspaceId = target.workspaceId
  if (!workspaceRuntimeId) return null
  if (target.kind === 'workspace-root') return { kind: 'workspace-root', workspaceId, workspaceRuntimeId }
  if (target.kind === 'git-branch') {
    return target.branchName ? { kind: 'git-branch', workspaceId, workspaceRuntimeId, branch: target.branchName } : null
  }
  const identity = worktreeTargetIdentity(workspaceId, target.worktreePath)
  return { kind: 'git-worktree', workspaceId, workspaceRuntimeId, root: identity.worktreeId }
}
