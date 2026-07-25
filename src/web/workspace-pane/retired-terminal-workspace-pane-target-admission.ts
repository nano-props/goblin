import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import type { WorkspaceCapabilityState } from '#/web/stores/workspaces/types.ts'

type ReadModelStatus = 'pending' | 'error' | 'success'

export type RetiredTerminalWorkspacePaneTargetAdmission =
  | { kind: 'pending'; workspaceRuntimeId: string | null }
  | { kind: 'ready'; workspaceRuntimeId: string; target: WorkspacePaneCommandTarget }
  | { kind: 'unavailable'; workspaceRuntimeId: string | null }

export function resolveRetiredTerminalWorkspacePaneTargetAdmission(input: {
  routeTarget: WorkspacePaneTabsTarget | null
  workspaceRuntimeId: string | null
  capabilityKind: WorkspaceCapabilityState['kind'] | null
  branchReadModelStatus: ReadModelStatus
  worktreeReadModelStatus: ReadModelStatus
  target: WorkspacePaneCommandTarget | null
}): RetiredTerminalWorkspacePaneTargetAdmission {
  const { routeTarget, workspaceRuntimeId, capabilityKind, target } = input
  if (!routeTarget) return { kind: 'unavailable', workspaceRuntimeId }
  if (!workspaceRuntimeId || capabilityKind === null || capabilityKind === 'probing') {
    return { kind: 'pending', workspaceRuntimeId }
  }
  if (capabilityKind === 'unavailable') return { kind: 'unavailable', workspaceRuntimeId }
  if (routeTarget.kind === 'workspace-root') {
    return target?.filesystemTarget
      ? { kind: 'ready', workspaceRuntimeId, target }
      : { kind: 'unavailable', workspaceRuntimeId }
  }
  if (capabilityKind !== 'git') return { kind: 'unavailable', workspaceRuntimeId }
  const requiredStatuses =
    routeTarget.kind === 'git-branch'
      ? [input.branchReadModelStatus, input.worktreeReadModelStatus]
      : [input.worktreeReadModelStatus]
  if (requiredStatuses.includes('error')) return { kind: 'unavailable', workspaceRuntimeId }
  if (requiredStatuses.some((status) => status !== 'success')) return { kind: 'pending', workspaceRuntimeId }
  return target?.filesystemTarget
    ? { kind: 'ready', workspaceRuntimeId, target }
    : { kind: 'unavailable', workspaceRuntimeId }
}
