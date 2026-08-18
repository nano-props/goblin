import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/terminal/components/terminal-create-feedback.ts'
import { readTerminalSessionCommandBridge } from '#/web/terminal/components/terminal-session-command-bridge.ts'
import type {
  ExistingTerminalPresentationRouteRequest,
  WorkspacePaneRuntimeTabCommandContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import type { WorkspaceCapabilities } from '#/shared/workspace-runtime.ts'
import type { CreatedTerminalRouteRequest } from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import {
  workspacePaneLocationTerminalBase,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

export interface WorkspacePaneRuntimeTabCommandContextInput {
  location: FilesystemWorkspacePaneLocation
  capabilities: WorkspaceCapabilities
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
  const base = input.capabilities.terminal.available ? workspacePaneLocationTerminalBase(input.location) : null
  context.terminal = {
    location: input.location,
    base,
    bridge: readTerminalSessionCommandBridge(),
    openerIdentity: base
      ? captureWorkspacePaneActiveTabIdentity(input.location, {
          workspacePaneRoute: input.workspacePaneRoute,
        })
      : null,
    showTerminalSession: (terminalSessionId, routeRequest) =>
      input.showRuntimeTab('terminal', terminalSessionId, routeRequest),
    showCreatedTerminalSession: (terminalSessionId, presentation, routeRequest) =>
      base ? input.showCreatedRuntimeTab('terminal', terminalSessionId, presentation, routeRequest) : false,
    t: input.terminalCreateTranslator,
  }
}
