import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type {
  ConfirmedWorkspacePaneRuntimeTabClose,
  WorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'

export interface WorkspacePaneRuntimeTabCloseCapabilityInput {
  type: WorkspacePaneRuntimeTabType
  terminalBase?: TerminalSessionBase | null
}

interface WorkspacePaneRuntimeTabCloseContextResolver {
  assign: (context: WorkspacePaneRuntimeTabCloseContext) => void
  canClose: (
    input: WorkspacePaneRuntimeTabCloseCapabilityInput,
    context: WorkspacePaneRuntimeTabCloseContext,
  ) => boolean
  canConfirm: (
    confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
    context: WorkspacePaneRuntimeTabCloseContext,
  ) => boolean
}

const WORKSPACE_PANE_RUNTIME_TAB_CLOSE_CONTEXT_RESOLVERS_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabCloseContextResolver
> = {
  terminal: {
    assign: assignTerminalRuntimeTabCloseContext,
    canClose: canCloseTerminalRuntimeTab,
    canConfirm: canConfirmTerminalRuntimeTabClose,
  },
}

export function readWorkspacePaneRuntimeTabCloseContext(): WorkspacePaneRuntimeTabCloseContext {
  const context: WorkspacePaneRuntimeTabCloseContext = {}
  for (const resolver of Object.values(WORKSPACE_PANE_RUNTIME_TAB_CLOSE_CONTEXT_RESOLVERS_BY_TYPE)) {
    resolver.assign(context)
  }
  return context
}

export function canConfirmWorkspacePaneRuntimeTabCloseWithContext(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: WorkspacePaneRuntimeTabCloseContext,
): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_CLOSE_CONTEXT_RESOLVERS_BY_TYPE[confirmed.type].canConfirm(confirmed, context)
}

export function canCloseWorkspacePaneRuntimeTabWithContext(
  input: WorkspacePaneRuntimeTabCloseCapabilityInput,
  context: WorkspacePaneRuntimeTabCloseContext,
): boolean {
  return WORKSPACE_PANE_RUNTIME_TAB_CLOSE_CONTEXT_RESOLVERS_BY_TYPE[input.type].canClose(input, context)
}

function assignTerminalRuntimeTabCloseContext(context: WorkspacePaneRuntimeTabCloseContext): void {
  const bridge = readTerminalSessionCommandBridge()
  if (!bridge?.closeTerminalByDescriptor && !bridge?.closeTerminalsForWorktree) return
  context.terminal = {
    closeTerminalByDescriptor: bridge.closeTerminalByDescriptor,
    closeTerminalsForWorktree: bridge.closeTerminalsForWorktree,
  }
}

function canCloseTerminalRuntimeTab(
  input: WorkspacePaneRuntimeTabCloseCapabilityInput,
  context: WorkspacePaneRuntimeTabCloseContext,
): boolean {
  if (input.type !== 'terminal') return false
  return !!input.terminalBase && !!context.terminal?.closeTerminalByDescriptor
}

function canConfirmTerminalRuntimeTabClose(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: WorkspacePaneRuntimeTabCloseContext,
): boolean {
  if (confirmed.type !== 'terminal') return false
  return canCloseTerminalRuntimeTab(
    {
      type: confirmed.type,
      terminalBase: confirmed.terminalBase,
    },
    context,
  )
}
