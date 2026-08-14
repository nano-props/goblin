import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'

export type WorkspaceRouteView =
  | { kind: 'empty'; workspaceId: WorkspaceId }
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspacePaneRoute: ParsedWorkspacePaneRoute | null }
  | {
      kind: 'worktree'
      workspaceId: WorkspaceId
      worktreePath: string
      workspacePaneRoute: ParsedWorkspacePaneRoute | null
    }
  | { kind: 'dashboard'; workspaceId: WorkspaceId }
  | {
      kind: 'branch'
      workspaceId: WorkspaceId
      branchName: string
      workspacePaneRoute: ParsedBranchWorkspacePaneRouteTarget
    }
  | { kind: 'newWorktree'; workspaceId: WorkspaceId }

export type WorkspacePaneRoute =
  { kind: 'static'; tab: WorkspacePaneStaticTabType } | { kind: 'terminal'; terminalSessionId: string }

export type WorkspacePaneRouteTarget = WorkspacePaneRoute | null
export type BranchWorkspacePaneRouteTarget = Extract<WorkspacePaneRoute, { kind: 'static' }> | null
export type ParsedWorkspacePaneRoute = WorkspacePaneRoute | { kind: 'invalid-static'; tabKey: string }
export type ParsedWorkspacePaneRouteTarget = ParsedWorkspacePaneRoute | null
export type ParsedBranchWorkspacePaneRouteTarget =
  BranchWorkspacePaneRouteTarget | Extract<ParsedWorkspacePaneRoute, { kind: 'invalid-static' }>
