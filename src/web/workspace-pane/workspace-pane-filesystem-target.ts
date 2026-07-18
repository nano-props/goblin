import { terminalGitWorktreePresentation, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { RuntimeWorkspacePaneTarget, WorkspaceCapabilities } from '#/shared/workspace-runtime.ts'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'

interface WorkspacePaneSurfaceTargetBase {
  workspaceId: string
  workspaceRuntimeId: string
  capabilities: WorkspaceCapabilities
}

export type WorkspacePaneSurfaceTarget =
  | (WorkspacePaneSurfaceTargetBase & { kind: 'workspace-root'; rootPath: string })
  | (WorkspacePaneSurfaceTargetBase & { kind: 'git-worktree'; head: GitHead; rootPath: string })
  | (WorkspacePaneSurfaceTargetBase & { kind: 'git-branch'; branchName: string })

export type WorkspacePaneFilesystemTarget = Exclude<WorkspacePaneSurfaceTarget, { kind: 'git-branch' }>

export function workspacePaneFilesystemRuntimeTarget(
  target: WorkspacePaneFilesystemTarget,
): RuntimeWorkspacePaneTarget | null {
  const tabsTarget =
    target.kind === 'workspace-root'
      ? { kind: 'workspace-root' as const, workspaceId: target.workspaceId }
      : gitWorktreeWorkspacePaneTabsTarget(target.workspaceId, target.rootPath)
  return tabsTarget ? runtimeWorkspacePaneTarget(tabsTarget, target.workspaceRuntimeId) : null
}

export function workspacePaneFilesystemTerminalBase(target: WorkspacePaneFilesystemTarget): TerminalSessionBase | null {
  if (!target.capabilities.terminal.available) return null
  const runtimeTarget = workspacePaneFilesystemRuntimeTarget(target)
  if (!runtimeTarget) return null
  return target.kind === 'workspace-root' && runtimeTarget.kind === 'workspace-root'
    ? { target: runtimeTarget, presentation: { kind: 'workspace-root' } }
    : target.kind === 'git-worktree' && runtimeTarget.kind === 'git-worktree'
      ? { target: runtimeTarget, presentation: { kind: 'git-worktree', head: target.head } }
      : null
}

export function workspacePaneTerminalBaseFromCoordinates(input: {
  workspaceId: string
  workspaceRuntimeId: string
  branchName: string | null
  rootPath: string
}): TerminalSessionBase | null {
  const tabsTarget =
    input.branchName === null
      ? { kind: 'workspace-root' as const, workspaceId: input.workspaceId }
      : gitWorktreeWorkspacePaneTabsTarget(input.workspaceId, input.rootPath)
  const runtimeTarget = tabsTarget ? runtimeWorkspacePaneTarget(tabsTarget, input.workspaceRuntimeId) : null
  if (!runtimeTarget) return null
  if (input.branchName === null && runtimeTarget.kind === 'workspace-root') {
    return { target: runtimeTarget, presentation: { kind: 'workspace-root' } }
  }
  if (input.branchName !== null && runtimeTarget.kind === 'git-worktree') {
    return { target: runtimeTarget, presentation: terminalGitWorktreePresentation(input.branchName) }
  }
  return null
}
