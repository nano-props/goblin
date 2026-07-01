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
