import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { RuntimeWorkspacePaneTarget, WorkspaceCapabilities } from '#/shared/workspace-runtime.ts'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'

interface WorkspacePaneSurfaceTargetBase {
  workspaceId: string
  workspaceRuntimeId: string
  capabilities: WorkspaceCapabilities
}

export type WorkspacePaneSurfaceTarget =
  | (WorkspacePaneSurfaceTargetBase & { kind: 'workspace-root'; rootPath: string })
  | (WorkspacePaneSurfaceTargetBase & { kind: 'git-worktree'; branchName: string; rootPath: string })
  | (WorkspacePaneSurfaceTargetBase & { kind: 'git-branch'; branchName: string })

export type WorkspacePaneFilesystemTarget = Exclude<WorkspacePaneSurfaceTarget, { kind: 'git-branch' }>

export function workspacePaneFilesystemRuntimeTarget(
  target: WorkspacePaneFilesystemTarget,
): RuntimeWorkspacePaneTarget | null {
  return runtimeWorkspacePaneTarget(
    target.kind === 'workspace-root'
      ? { kind: 'workspace-root', repoRoot: target.workspaceId, branchName: null, worktreePath: null }
      : { repoRoot: target.workspaceId, branchName: target.branchName, worktreePath: target.rootPath },
    target.workspaceRuntimeId,
  )
}

export function workspacePaneFilesystemTerminalBase(
  target: WorkspacePaneFilesystemTarget,
): TerminalSessionBase | null {
  if (!target.capabilities.terminal.available) return null
  const runtimeTarget = workspacePaneFilesystemRuntimeTarget(target)
  if (!runtimeTarget) return null
  return {
    repoRoot: target.workspaceId,
    repoRuntimeId: target.workspaceRuntimeId,
    branch: target.kind === 'git-worktree' ? target.branchName : '',
    worktreePath: target.rootPath,
    target: runtimeTarget,
  }
}
