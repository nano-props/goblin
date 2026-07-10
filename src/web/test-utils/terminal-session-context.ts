import { vi } from 'vitest'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneTabsWithRuntimeTab } from '#/web/workspace-pane/workspace-pane-tabs.ts'

type TestTerminalSessionContextValue = Omit<TerminalSessionContextValue, 'createTerminalWithAdmission'> &
  Partial<Pick<TerminalSessionContextValue, 'createTerminalWithAdmission'>>

export function createTerminalWithAdmissionForContextTest(
  createTerminal: TerminalSessionContextValue['createTerminal'],
): TerminalSessionContextValue['createTerminalWithAdmission'] {
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

export function terminalSessionContextForTest(context: TestTerminalSessionContextValue): TerminalSessionContextValue {
  const createTerminalWithAdmission =
    context.createTerminalWithAdmission ?? createTerminalWithAdmissionForContextTest(context.createTerminal)
  return { ...context, createTerminalWithAdmission }
}
