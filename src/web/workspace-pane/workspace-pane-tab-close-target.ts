import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  resolveWorkspacePaneTabTargetForPaneTarget,
  scopeWorkspacePaneTabTargetResolutionToRuntime,
  type WorkspacePaneTabTargetResolution,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

export function resolveCloseWorkspacePaneTarget(
  input: {
    workspaceId: WorkspaceId | null
    workspaceRuntimeId: string
    location: WorkspacePaneLocation
  },
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabTargetResolution {
  if (!input.workspaceId) return { kind: 'missing' }
  const resolution = resolveWorkspacePaneTabTargetForPaneTarget({
    location: input.location,
    workspacePaneRoute,
  })
  return scopeWorkspacePaneTabTargetResolutionToRuntime(resolution, input.workspaceRuntimeId)
}

export function workspacePaneTabsTargetForClose(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  if (target.paneTarget.kind === 'inactive') throw new Error('inactive workspace pane has no persistence target')
  return target.paneTarget
}

export function workspacePaneRouteTargetForClose(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  if (target.routeTarget.kind === 'inactive') throw new Error('inactive workspace pane has no route target')
  return target.routeTarget
}
