import {
  terminalExecutionCoordinates,
  terminalExecutionPath,
  type TerminalPresentation,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { WorkspacePaneRuntimeTabCommandContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-command-actions.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { resolveWorkspacePaneTerminalExecutionTarget } from '#/web/workspace-pane/workspace-pane-terminal-execution-target.ts'

type WorkspacePaneCommandRoute = ParsedRepoBranchWorkspacePaneRoute | null | undefined

export interface WorkspacePaneRuntimeTabCommandContextInput {
  repoId: string
  branchName: string | null
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
  const base = resolveWorkspacePaneTerminalExecutionTarget(input.repoId, input.branchName)
  context.terminal = {
    base,
    bridge: readTerminalSessionCommandBridge(),
    openerIdentity: captureWorkspacePaneActiveTabIdentity(
      input.repoId,
      useReposStore.getState().repos[input.repoId]?.repoRuntimeId ?? '',
      input.branchName,
      {
        workspacePaneRoute: input.workspacePaneRoute,
      },
    ),
    showTerminalSession: (terminalSessionId) => input.showRuntimeTab('terminal', terminalSessionId),
    showCreatedTerminalSession: (terminalSessionId, presentation) =>
      base
        ? input.showCreatedRuntimeTab(
            'terminal',
            terminalSessionId,
            presentation,
            terminalExecutionPath(base.target),
          )
        : false,
    t: input.terminalCreateTranslator,
  }
}
