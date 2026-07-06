import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { WorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'

export interface WorkspacePaneRuntimeTabActionContextInput {
  enterRuntimeTab: (type: WorkspacePaneRuntimeTabType) => void
  terminal?: NonNullable<WorkspacePaneRuntimeTabActionContext['terminal']>
}

interface WorkspacePaneRuntimeTabActionContextResolver {
  assign: (
    context: WorkspacePaneRuntimeTabActionContext,
    input: WorkspacePaneRuntimeTabActionContextInput,
  ) => void
}

const WORKSPACE_PANE_RUNTIME_TAB_ACTION_CONTEXT_RESOLVERS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabActionContextResolver
> = {
  terminal: {
    assign: assignTerminalRuntimeTabActionContext,
  },
}

export function createWorkspacePaneRuntimeTabActionContext(
  input: WorkspacePaneRuntimeTabActionContextInput,
): WorkspacePaneRuntimeTabActionContext {
  const context: WorkspacePaneRuntimeTabActionContext = {
    enterRuntimeTab: input.enterRuntimeTab,
  }
  for (const resolver of Object.values(WORKSPACE_PANE_RUNTIME_TAB_ACTION_CONTEXT_RESOLVERS_BY_TYPE)) {
    resolver.assign(context, input)
  }
  return context
}

export function readWorkspacePaneRuntimeTabActionContext(input: {
  enterRuntimeTab: (type: WorkspacePaneRuntimeTabType) => void
}): WorkspacePaneRuntimeTabActionContext {
  return createWorkspacePaneRuntimeTabActionContext({
    enterRuntimeTab: input.enterRuntimeTab,
    terminal: readTerminalRuntimeTabActionContext(),
  })
}

function assignTerminalRuntimeTabActionContext(
  context: WorkspacePaneRuntimeTabActionContext,
  input: WorkspacePaneRuntimeTabActionContextInput,
): void {
  if (input.terminal) context.terminal = input.terminal
}

function readTerminalRuntimeTabActionContext(): NonNullable<
  WorkspacePaneRuntimeTabActionContext['terminal']
> | undefined {
  const bridge = readTerminalSessionCommandBridge()
  return bridge
    ? {
        selectTerminal: bridge.selectTerminal,
      }
    : undefined
}
