import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type {
  ConfirmedWorkspacePaneRuntimeTabClose,
  TerminalWorkspacePaneRuntimeTabCloseContext,
  WorkspacePaneRuntimeTabCloseTarget,
  WorkspacePaneRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'
import {
  terminalBaseForRuntimeTabCloseTarget,
  terminalRuntimeTabCloseContext,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

export interface WorkspacePaneRuntimeTabCloseCapabilityInput {
  type: WorkspacePaneRuntimeTabType
  target: WorkspacePaneRuntimeTabCloseTarget
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
  const context: WorkspacePaneRuntimeTabCloseContext = { byType: {} }
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
  if (!bridge?.closeTerminalByDescriptor) return
  context.byType.terminal = {
    closeTerminalByDescriptor: bridge.closeTerminalByDescriptor,
  } satisfies TerminalWorkspacePaneRuntimeTabCloseContext
}

function canCloseTerminalRuntimeTab(
  input: WorkspacePaneRuntimeTabCloseCapabilityInput,
  context: WorkspacePaneRuntimeTabCloseContext,
): boolean {
  if (input.type !== 'terminal') return false
  return !!terminalBaseForRuntimeTabCloseTarget(input.target) && !!terminalRuntimeTabCloseContext(context)?.closeTerminalByDescriptor
}

function canConfirmTerminalRuntimeTabClose(
  confirmed: ConfirmedWorkspacePaneRuntimeTabClose,
  context: WorkspacePaneRuntimeTabCloseContext,
): boolean {
  if (confirmed.type !== 'terminal') return false
  return canCloseTerminalRuntimeTab(
    {
      type: confirmed.type,
      target: confirmed.target,
    },
    context,
  )
}
