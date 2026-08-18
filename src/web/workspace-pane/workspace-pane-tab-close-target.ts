import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import {
  requiredWorkspacePaneTabModelLocation,
  type WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import {
  resolveWorkspacePaneTabTargetForPaneTarget,
  type WorkspacePaneTabTargetResolution,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

export function resolveCloseWorkspacePaneTarget(
  input: {
    workspaceId: WorkspaceId | null
    location: WorkspacePaneLocation
  },
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined,
): WorkspacePaneTabTargetResolution {
  if (input.workspaceId !== input.location.workspaceId) return { kind: 'missing' }
  return resolveWorkspacePaneTabTargetForPaneTarget({
    location: input.location,
    workspacePaneRoute,
  })
}

export function workspacePaneTabsTargetForClose(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  return requiredWorkspacePaneTabModelLocation(target).paneTarget
}

export function workspacePaneRouteTargetForClose(target: WorkspacePaneTabModel): WorkspacePaneTabsTarget {
  return requiredWorkspacePaneTabModelLocation(target).routeTarget
}
