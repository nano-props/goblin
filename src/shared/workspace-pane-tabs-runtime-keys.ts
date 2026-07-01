import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneTabsRuntimeKeyInput {
  userId: string | number
  scope: string
  branchName: string
  worktreePath: string | null
}

export function workspacePaneTabsRuntimeKey(input: WorkspacePaneTabsRuntimeKeyInput): string {
  return `${String(input.userId)}\0${workspacePaneTabsTargetIdentityKey({
    repoRoot: input.scope,
    branchName: input.branchName,
    worktreePath: input.worktreePath,
  })}`
}

export function workspacePaneTabsRuntimeScopePrefixKey(userId: string | number, scope: string): string {
  return `${String(userId)}\0${scope}\0`
}

export function workspacePaneTabsRuntimeUserPrefixKey(userId: string | number): string {
  return `${String(userId)}\0`
}
