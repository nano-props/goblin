import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import type { TerminalWorkspacePaneRuntimeTabCloseContext } from '#/web/workspace-pane/workspace-pane-runtime-tab-close-actions.ts'

export function readWorkspacePaneRuntimeTabCloseContext(): TerminalWorkspacePaneRuntimeTabCloseContext | null {
  const bridge = readTerminalSessionCommandBridge()
  return bridge ? { closeTerminalByDescriptor: bridge.closeTerminalByDescriptor } : null
}
