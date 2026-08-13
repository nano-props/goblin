import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { GitHead } from '#/shared/git-head.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { workspacePaneTabTargetForPaneTarget } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'

export function resolveCloseWorkspacePaneTarget(
  input: {
    workspaceId: WorkspaceId | null
    workspaceRuntimeId: string
    routeTarget: WorkspacePaneTabsTarget
    paneTarget: WorkspacePaneTabsTarget
    worktreeHead?: GitHead
  },
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabModel | null {
  if (!input.workspaceId) return null
  const target = workspacePaneTabTargetForPaneTarget({
    paneTarget: input.paneTarget,
    routeTarget: input.routeTarget,
    workspacePaneRoute,
    worktreeHead: input.worktreeHead,
  })
  return target?.workspaceRuntimeId === input.workspaceRuntimeId ? target : null
}

export function workspacePaneTabsTargetForClose(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  if (target.paneTarget.kind === 'inactive') throw new Error('inactive workspace pane has no persistence target')
  return target.paneTarget
}

export function workspacePaneRouteTargetForClose(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  if (target.routeTarget.kind === 'inactive') throw new Error('inactive workspace pane has no route target')
  return target.routeTarget
}
