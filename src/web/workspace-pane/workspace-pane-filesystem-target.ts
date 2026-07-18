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
  return workspacePaneTerminalBaseFromCoordinates({
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    branchName: target.kind === 'git-worktree' ? target.branchName : null,
    rootPath: target.rootPath,
  })
}

export function workspacePaneTerminalBaseFromCoordinates(input: {
  workspaceId: string
  workspaceRuntimeId: string
  branchName: string | null
  rootPath: string
}): TerminalSessionBase | null {
  const runtimeTarget = runtimeWorkspacePaneTarget(
    input.branchName === null
      ? { kind: 'workspace-root', repoRoot: input.workspaceId, branchName: null, worktreePath: null }
      : { repoRoot: input.workspaceId, branchName: input.branchName, worktreePath: input.rootPath },
    input.workspaceRuntimeId,
  )
  if (!runtimeTarget) return null
  if (input.branchName === null && runtimeTarget.kind === 'workspace-root') {
    return { target: runtimeTarget, presentation: { kind: 'workspace-root' } }
  }
  if (input.branchName !== null && runtimeTarget.kind === 'git-worktree') {
    return { target: runtimeTarget, presentation: { kind: 'git-worktree', branchName: input.branchName } }
  }
  return null
}
