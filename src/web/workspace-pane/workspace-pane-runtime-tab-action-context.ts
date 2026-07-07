import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRuntimeTabActionContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-actions.ts'

export interface WorkspacePaneRuntimeTabActionContextInput {
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => void
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
    showRuntimeTab: input.showRuntimeTab,
  }
  for (const resolver of Object.values(WORKSPACE_PANE_RUNTIME_TAB_ACTION_CONTEXT_RESOLVERS_BY_TYPE)) {
    resolver.assign(context, input)
  }
  return context
}

export function readWorkspacePaneRuntimeTabActionContext(input: {
  showRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => void
}): WorkspacePaneRuntimeTabActionContext {
  return createWorkspacePaneRuntimeTabActionContext({
    showRuntimeTab: input.showRuntimeTab,
  })
}

function assignTerminalRuntimeTabActionContext(
  context: WorkspacePaneRuntimeTabActionContext,
  input: WorkspacePaneRuntimeTabActionContextInput,
): void {
  if (input.terminal) context.terminal = input.terminal
}
