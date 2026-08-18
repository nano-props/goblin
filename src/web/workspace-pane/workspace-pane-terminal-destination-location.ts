import type { WorkspaceRepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { terminalExecutionPath, type TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import {
  workspacePaneLocationForRoot,
  workspacePaneLocationForWorktree,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export type WorkspacePaneTerminalDestinationLocation =
  | {
      kind: 'ready'
      location: FilesystemWorkspacePaneLocation
      worktree: WorkspaceRepoWorktreeSnapshot | null
    }
  | { kind: 'pending' }
  | { kind: 'unavailable' }
  | { kind: 'stale' }

export type WorkspacePaneTerminalDestinationSnapshot =
  { kind: 'ready'; worktrees: readonly WorkspaceRepoWorktreeSnapshot[] } | { kind: 'pending' } | { kind: 'unavailable' }

export function resolveWorkspacePaneTerminalDestinationLocation(input: {
  workspace: Pick<WorkspaceState, 'id' | 'workspaceRuntimeId' | 'capability'>
  base: TerminalSessionBase
  snapshot: WorkspacePaneTerminalDestinationSnapshot
}): WorkspacePaneTerminalDestinationLocation {
  const { workspace, base, snapshot } = input
  const target = base.target
  if (target.workspaceId !== workspace.id || target.workspaceRuntimeId !== workspace.workspaceRuntimeId) {
    return { kind: 'stale' }
  }

  if (workspace.capability.kind === 'probing') return { kind: 'pending' }
  if (workspace.capability.kind === 'unavailable') return { kind: 'unavailable' }
  if (workspace.capability.kind === 'filesystem') {
    return target.kind === 'workspace-root'
      ? {
          kind: 'ready',
          location: workspacePaneLocationForRoot(workspace.id, workspace.workspaceRuntimeId),
          worktree: null,
        }
      : { kind: 'unavailable' }
  }

  if (snapshot.kind !== 'ready') return snapshot
  const { worktrees } = snapshot
  if (target.kind === 'workspace-root') {
    const sourceWorktrees = worktrees.filter((worktree) => worktree.isSource)
    const sourceWorktree = sourceWorktrees.length === 1 ? sourceWorktrees[0] : null
    return sourceWorktree
      ? {
          kind: 'ready',
          location: workspacePaneLocationForWorktree(workspace.id, workspace.workspaceRuntimeId, sourceWorktree),
          worktree: sourceWorktree,
        }
      : { kind: 'unavailable' }
  }

  const executionPath = terminalExecutionPath(target)
  const worktree = worktrees.find((candidate) => candidate.path === executionPath)
  if (!worktree || worktree.isSource) return { kind: 'unavailable' }
  return {
    kind: 'ready',
    location: workspacePaneLocationForWorktree(workspace.id, workspace.workspaceRuntimeId, worktree),
    worktree,
  }
}
