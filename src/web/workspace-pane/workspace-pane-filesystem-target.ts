import { terminalGitWorktreePresentation, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  parseCanonicalWorkspaceLocator,
  workspaceLocatorForPath,
  type WorkspaceId,
} from '#/shared/workspace-locator.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type {
  WorkspaceCapabilities,
  WorkspaceGitReadyProbeState,
  WorkspacePaneFilesystemExecutionTarget,
} from '#/shared/workspace-runtime.ts'
import { gitWorktreeWorkspacePaneTabsTarget, runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'

interface WorkspacePaneSurfaceTargetBase {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  capabilities: WorkspaceCapabilities
}

const workspacePaneFilesystemTargetBrand: unique symbol = Symbol('WorkspacePaneFilesystemTarget')

export type WorkspacePaneFilesystemTarget =
  | (WorkspacePaneSurfaceTargetBase & {
      kind: 'workspace-root'
      rootId: WorkspaceId
      readonly [workspacePaneFilesystemTargetBrand]: true
    })
  | (WorkspacePaneSurfaceTargetBase & {
      kind: 'git-worktree'
      head: GitHead
      rootId: WorkspaceId
      readonly [workspacePaneFilesystemTargetBrand]: true
    })

export type WorkspacePaneSurfaceTarget =
  WorkspacePaneFilesystemTarget | (WorkspacePaneSurfaceTargetBase & { kind: 'git-branch'; branchName: string })

type WorkspacePaneFilesystemTargetInput = WorkspacePaneSurfaceTargetBase

export function workspaceRootPaneFilesystemTarget(
  input: WorkspacePaneFilesystemTargetInput,
): Extract<WorkspacePaneFilesystemTarget, { kind: 'workspace-root' }> {
  if (!parseCanonicalWorkspaceLocator(input.workspaceId)?.path) {
    throw new Error('workspace root target requires a canonical WorkspaceId')
  }
  return { ...input, kind: 'workspace-root', rootId: input.workspaceId, [workspacePaneFilesystemTargetBrand]: true }
}

export function gitWorktreePaneFilesystemTarget(
  input: Omit<WorkspacePaneFilesystemTargetInput, 'capabilities'> & {
    capabilities: WorkspaceGitReadyProbeState['capabilities']
    worktreePath: string
    head: GitHead
  },
): Extract<WorkspacePaneFilesystemTarget, { kind: 'git-worktree' }> {
  const rootId = workspaceLocatorForPath(input.workspaceId, input.worktreePath)
  if (!rootId) {
    throw new Error('Git worktree target must share the Workspace transport')
  }
  return {
    kind: 'git-worktree',
    workspaceId: input.workspaceId,
    workspaceRuntimeId: input.workspaceRuntimeId,
    capabilities: input.capabilities,
    rootId,
    head: input.head,
    [workspacePaneFilesystemTargetBrand]: true,
  }
}

export function workspacePaneFilesystemRuntimeTarget(
  target: Extract<WorkspacePaneFilesystemTarget, { kind: 'workspace-root' }>,
): Extract<WorkspacePaneFilesystemExecutionTarget, { kind: 'workspace-root' }>
export function workspacePaneFilesystemRuntimeTarget(
  target: Extract<WorkspacePaneFilesystemTarget, { kind: 'git-worktree' }>,
): Extract<WorkspacePaneFilesystemExecutionTarget, { kind: 'git-worktree' }>
export function workspacePaneFilesystemRuntimeTarget(
  target: WorkspacePaneFilesystemTarget,
): WorkspacePaneFilesystemExecutionTarget
export function workspacePaneFilesystemRuntimeTarget(
  target: WorkspacePaneFilesystemTarget,
): WorkspacePaneFilesystemExecutionTarget {
  return target.kind === 'workspace-root'
    ? {
        kind: 'workspace-root',
        workspaceId: target.workspaceId,
        workspaceRuntimeId: target.workspaceRuntimeId,
      }
    : {
        kind: 'git-worktree',
        workspaceId: target.workspaceId,
        workspaceRuntimeId: target.workspaceRuntimeId,
        root: target.rootId,
      }
}

export function workspacePaneFilesystemRootPath(target: WorkspacePaneFilesystemTarget): string {
  const rootPath = parseCanonicalWorkspaceLocator(target.rootId)?.path
  if (!rootPath) throw new Error('filesystem target requires a canonical root identity')
  return rootPath
}

export function workspacePaneFilesystemTerminalBase(target: WorkspacePaneFilesystemTarget): TerminalSessionBase | null {
  if (!target.capabilities.terminal.available) return null
  return target.kind === 'workspace-root'
    ? { target: workspacePaneFilesystemRuntimeTarget(target), presentation: { kind: 'workspace-root' } }
    : {
        target: workspacePaneFilesystemRuntimeTarget(target),
        presentation: { kind: 'git-worktree', head: target.head },
      }
}

export function workspacePaneTerminalBaseFromCoordinates(input: {
  workspaceId: WorkspaceId
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
