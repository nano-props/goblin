import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalPresentation,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { WorkspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { WorkspacePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneFilesystemTerminalBase } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'

type WorkspacePaneCommandRoute = ParsedWorkspacePaneRoute | null | undefined

export interface WorkspacePaneRuntimeTabCommandContextInput {
  workspaceId: string
  branchName: string | null
  filesystemTarget: WorkspacePaneFilesystemTarget | null
  workspacePaneRoute: WorkspacePaneCommandRoute
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => boolean | Promise<boolean>
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    worktreePath: string,
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
    base,
    bridge: readTerminalSessionCommandBridge(),
    openerIdentity:
      base && paneTarget
        ? captureWorkspacePaneActiveTabIdentity(paneTarget, base.target.workspaceRuntimeId, {
            workspacePaneRoute: input.workspacePaneRoute,
          })
        : null,
    showTerminalSession: (terminalSessionId) => input.showRuntimeTab('terminal', terminalSessionId),
    showCreatedTerminalSession: (terminalSessionId, presentation) =>
      base
        ? input.showCreatedRuntimeTab('terminal', terminalSessionId, presentation, terminalExecutionPath(base.target))
        : false,
    t: input.terminalCreateTranslator,
  }
}
