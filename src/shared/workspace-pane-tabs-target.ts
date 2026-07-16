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

export function workspacePaneTabsEntryMatchesTarget(
  entry: WorkspacePaneTabsTarget,
  target: WorkspacePaneTabsTarget,
): boolean {
  return workspacePaneTabsTargetIdentityKey(entry) === workspacePaneTabsTargetIdentityKey(target)
}

export function restorableWorkspacePaneTargetKey(target: RestorableWorkspacePaneTarget): string {
  if (target.kind === 'workspace') return 'workspace'
  if (target.kind === 'git-branch') return `git-branch\0${target.branch}`
  return `git-worktree\0${target.root}`
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
  const platform = typeof process !== 'undefined' && process.platform === 'win32' ? 'win32' : 'posix'
  const parsed = parseWorkspaceLocator(value, platform)
  const root = parsed ? formatWorkspaceLocator(parsed, platform) : null
  return root === value ? { kind, root } : null
}

export function restorableWorkspacePaneTarget(
  target: WorkspacePaneTabsTarget,
): RestorableWorkspacePaneTarget | null {
  if (target.worktreePath === null) return { kind: 'git-branch', branch: target.branchName }
  if (target.worktreePath === target.repoRoot) return { kind: 'workspace' }
  const platform = typeof process !== 'undefined' && process.platform === 'win32' ? 'win32' : 'posix'
  const workspace = parseWorkspaceLocator(target.repoRoot, platform)
  if (!workspace) return null
  const root = formatWorkspaceLocator(
    workspace.transport === 'ssh'
      ? { transport: 'ssh', profile: workspace.profile, path: target.worktreePath }
      : { transport: 'file', platform: workspace.platform, path: target.worktreePath },
    platform,
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
  const platform = typeof process !== 'undefined' && process.platform === 'win32' ? 'win32' : 'posix'
  const root = parseWorkspaceLocator(target.root, platform)
  const workspace = parseWorkspaceLocator(workspaceId, platform)
  if (!root || !workspace || root.transport !== workspace.transport) return null
  if (root.transport === 'ssh' && (workspace.transport !== 'ssh' || root.profile !== workspace.profile)) return null
  return { repoRoot: workspaceId, branchName: '', worktreePath: root.path }
}
import type { RestorableWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { formatWorkspaceLocator, parseWorkspaceLocator } from '#/shared/workspace-locator.ts'
