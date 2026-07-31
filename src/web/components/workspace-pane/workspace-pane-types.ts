import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { GitWorkspacePaneProjection } from '#/web/components/repo-workspace/model.ts'
import type { WorkspaceReadyProbeState } from '#/shared/workspace-runtime.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitWorkspaceClientState, WorkspaceState } from '#/web/stores/workspaces/types.ts'

export type WorkspacePaneRouteContext =
  | { kind: 'workspace-root'; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'git-worktree'; worktreePath: string; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'routed'; route: ParsedWorkspacePaneRoute | null }
  | { kind: 'inactive' }

interface GitWorkspacePaneOperations {
  branchAction: GitWorkspaceClientState['operations']['branchAction']
}

interface FilesystemWorkspacePaneUi {
  preferredWorkspacePaneTabByTarget: WorkspaceState['ui']['preferredWorkspacePaneTabByTarget']
  currentBranchName: string | null
}

export type GitWorkspacePaneShell = Omit<GitWorkspacePaneProjection, 'snapshot' | 'status' | 'branchAction'> & {
  operations: GitWorkspacePaneOperations
  probe: WorkspaceReadyProbeState
}

export interface FilesystemWorkspacePaneProjection {
  id: WorkspaceId
  workspaceRuntimeId: string
  ui: FilesystemWorkspacePaneUi
  probe: WorkspaceReadyProbeState
}
