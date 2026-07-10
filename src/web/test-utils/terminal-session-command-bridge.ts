import { vi } from 'vitest'
import {
  setTerminalSessionCommandBridge as setTerminalSessionCommandBridgeBase,
  type TerminalSessionCommandBridge,
} from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsWithRuntimeTab } from '#/web/workspace-pane/workspace-pane-tabs.ts'

type TestTerminalSessionCommandBridge = Omit<TerminalSessionCommandBridge, 'createTerminalWithAdmission'> &
  Partial<Pick<TerminalSessionCommandBridge, 'createTerminalWithAdmission'>>

export function createTerminalWithAdmissionForTest(
  createTerminal: TerminalSessionCommandBridge['createTerminal'],
): TerminalSessionCommandBridge['createTerminalWithAdmission'] {
  return vi.fn(async (base, options, placement) => {
    const terminalSessionId = await createTerminal(base, options)
    const currentTabs = base.repoRuntimeId
      ? readWorkspacePaneTabsForTarget({
          repoRoot: base.repoRoot,
          repoRuntimeId: base.repoRuntimeId,
          branchName: base.branch,
          worktreePath: base.worktreePath,
        })
      : []
    return {
      terminalSessionId,
      requestRole: 'leader' as const,
      resourceDisposition: 'created' as const,
      workspacePaneTabs: workspacePaneTabsWithRuntimeTab(currentTabs, 'terminal', terminalSessionId, placement),
    }
  })
}

export function setTerminalSessionCommandBridgeForTest(next: TestTerminalSessionCommandBridge | null): () => void {
  if (!next) return setTerminalSessionCommandBridgeBase(null)
  const createTerminalWithAdmission =
    next.createTerminalWithAdmission ?? createTerminalWithAdmissionForTest(next.createTerminal)
  return setTerminalSessionCommandBridgeBase({ ...next, createTerminalWithAdmission })
}
