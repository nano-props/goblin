import type { RestorableWorkspacePaneTarget, RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import {
  canonicalWorkspaceLocator,
  formatWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
} from '#/shared/workspace-locator.ts'

export interface WorkspacePaneTabsTarget {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}

export type WorkspacePaneTabsTargetIdentity =
  | {
      kind: 'branch'
      repoRoot: string
      branchName: string
    }
  | {
      kind: 'worktree'
      repoRoot: string
      worktreePath: string
    }

export function workspacePaneTabsTargetIdentityKey(target: WorkspacePaneTabsTarget): string {
  return workspacePaneTabsTargetIdentityKeyFromIdentity(
    target.worktreePath !== null
      ? { kind: 'worktree', repoRoot: target.repoRoot, worktreePath: target.worktreePath }
      : { kind: 'branch', repoRoot: target.repoRoot, branchName: target.branchName },
  )
}

export function workspacePaneTabsTargetIdentityKeyFromIdentity(target: WorkspacePaneTabsTargetIdentity): string {
  if (target.kind === 'worktree') return `${target.repoRoot}\0worktree\0${target.worktreePath}`
  return `${target.repoRoot}\0branch\0${target.branchName}`
}

export function parseWorkspacePaneTabsTargetIdentityKey(key: string): WorkspacePaneTabsTargetIdentity | null {
  const parts = key.split('\0')
  if (parts.length !== 3) return null
  const [repoRoot, kind, value] = parts
  if (!repoRoot || !value) return null
  if (kind === 'branch') return { kind, repoRoot, branchName: value }
  if (kind === 'worktree') return { kind, repoRoot, worktreePath: value }
  return null
}

export function restorableWorkspacePaneTargetKey(target: RestorableWorkspacePaneTarget): string {
  if (target.kind === 'workspace') return 'workspace'
  if (target.kind === 'git-branch') return `git-branch\0${target.branch}`
  return `git-worktree\0${target.root}`
}

export function restorableWorkspacePaneTargetFromRuntime(
  target: RuntimeWorkspacePaneTarget,
): RestorableWorkspacePaneTarget | null {
  if (!target.workspaceId || !target.workspaceRuntimeId) return null
  if (target.kind === 'workspace') return { kind: 'workspace' }
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
  if (key === 'workspace') return { kind: 'workspace' }
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
  if (target.worktreePath === null) return { kind: 'git-branch', branch: target.branchName }
  if (target.worktreePath === target.repoRoot) return { kind: 'workspace' }
  const workspace = parseCanonicalWorkspaceLocator(target.repoRoot)
  if (!workspace) return null
  const root = formatWorkspaceLocator(
    workspace.transport === 'ssh'
      ? { transport: 'ssh', profile: workspace.profile, path: target.worktreePath }
      : { transport: 'file', platform: workspace.platform, path: target.worktreePath },
    workspace.transport === 'file' ? workspace.platform : 'posix',
  )
  return root ? { kind: 'git-worktree', root } : null
}

export function workspacePaneTabsTargetFromRestorable(
  workspaceId: string,
  target: RestorableWorkspacePaneTarget,
): WorkspacePaneTabsTarget | null {
  if (target.kind === 'workspace') return { repoRoot: workspaceId, branchName: '', worktreePath: workspaceId }
  if (target.kind === 'git-branch') {
    return { repoRoot: workspaceId, branchName: target.branch, worktreePath: null }
  }
  const root = parseCanonicalWorkspaceLocator(target.root)
  const workspace = parseCanonicalWorkspaceLocator(workspaceId)
  if (!root || !workspace || root.transport !== workspace.transport) return null
  if (root.transport === 'ssh' && (workspace.transport !== 'ssh' || root.profile !== workspace.profile)) return null
  return { repoRoot: workspaceId, branchName: '', worktreePath: root.path }
}

export function workspacePaneTabsTargetFromRuntime(target: RuntimeWorkspacePaneTarget): WorkspacePaneTabsTarget | null {
  if (!target.workspaceId || !target.workspaceRuntimeId) return null
  if (target.kind === 'workspace') {
    return { repoRoot: target.workspaceId, branchName: '', worktreePath: target.workspaceId }
  }
  if (target.kind === 'git-branch') {
    return target.branch ? { repoRoot: target.workspaceId, branchName: target.branch, worktreePath: null } : null
  }
  const workspace = parseCanonicalWorkspaceLocator(target.workspaceId)
  const root = parseCanonicalWorkspaceLocator(target.root)
  if (!workspace || !root || workspace.transport !== root.transport) return null
  if (workspace.transport === 'ssh' && (root.transport !== 'ssh' || workspace.profile !== root.profile)) return null
  return { repoRoot: target.workspaceId, branchName: '', worktreePath: root.path }
}

export function runtimeWorkspacePaneTarget(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
): RuntimeWorkspacePaneTarget | null {
  const workspaceId = canonicalWorkspaceLocator(target.repoRoot)
  if (!workspaceId || !workspaceRuntimeId) return null
  if (target.worktreePath === target.repoRoot) return { kind: 'workspace', workspaceId, workspaceRuntimeId }
  if (target.worktreePath === null) {
    return target.branchName ? { kind: 'git-branch', workspaceId, workspaceRuntimeId, branch: target.branchName } : null
  }
  const restorable = restorableWorkspacePaneTarget(target)
  return restorable?.kind === 'git-worktree'
    ? { kind: 'git-worktree', workspaceId, workspaceRuntimeId, root: restorable.root }
    : null
}
