import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalPresentation,
} from '#/shared/terminal-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type {
  ExistingTerminalPresentationRouteRequest,
  WorkspacePaneRuntimeTabCommandContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  workspacePaneTabsTargetFromRuntime,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { PrimaryWindowPresentationToken } from '#/web/primary-window-presentation.ts'
import type { CreatedTerminalRouteRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

export interface WorkspacePaneRuntimeTabCommandContextInput {
  workspaceId: WorkspaceId
  routeTarget: WorkspacePaneTabsTarget
  branchName: string | null
  filesystemTarget: WorkspacePaneFilesystemTarget | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  showRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    routeRequest: ExistingTerminalPresentationRouteRequest,
  ) => boolean | Promise<boolean>
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    worktreePath: string,
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  terminalCreateTranslator?: TerminalCreateTranslator
}

interface WorkspacePaneRuntimeTabCommandContextResolver {
  assign: (context: WorkspacePaneRuntimeTabCommandContext, input: WorkspacePaneRuntimeTabCommandContextInput) => void
}

const WORKSPACE_PANE_RUNTIME_TAB_COMMAND_CONTEXT_RESOLVERS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCommandContextResolver
> = {
  terminal: {
    assign: assignTerminalRuntimeTabCommandContext,
  },
}

export function workspacePaneRuntimeTabCommandContext(
  input: WorkspacePaneRuntimeTabCommandContextInput,
): WorkspacePaneRuntimeTabCommandContext {
  const context: WorkspacePaneRuntimeTabCommandContext = {}
  for (const resolver of Object.values(WORKSPACE_PANE_RUNTIME_TAB_COMMAND_CONTEXT_RESOLVERS_BY_TYPE)) {
    resolver.assign(context, input)
  }
  return context
}

function assignTerminalRuntimeTabCommandContext(
  context: WorkspacePaneRuntimeTabCommandContext,
  input: WorkspacePaneRuntimeTabCommandContextInput,
): void {
  const base = input.filesystemTarget ? workspacePaneFilesystemTerminalBase(input.filesystemTarget) : null
  const paneTarget = base ? workspacePaneTabsTargetFromRuntime(base.target) : null
  context.terminal = {
    routeTarget: input.routeTarget,
    base,
    bridge: readTerminalSessionCommandBridge(),
    openerIdentity:
      base && paneTarget
        ? captureWorkspacePaneActiveTabIdentity(paneTarget, base.target.workspaceRuntimeId, {
            workspacePaneRoute: input.workspacePaneRoute,
          })
        : null,
    showTerminalSession: (terminalSessionId, routeRequest) =>
      input.showRuntimeTab('terminal', terminalSessionId, routeRequest),
    showCreatedTerminalSession: (terminalSessionId, presentation, routeRequest) =>
      base
        ? input.showCreatedRuntimeTab(
            'terminal',
            terminalSessionId,
            presentation,
            terminalExecutionPath(base.target),
            routeRequest,
          )
        : false,
    t: input.terminalCreateTranslator,
  }
}
