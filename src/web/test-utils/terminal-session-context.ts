import { vi } from 'vitest'
import type { TerminalSessionContextValue } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsWithRuntimeTab } from '#/shared/workspace-pane.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

type TestTerminalSessionContextValue = Omit<TerminalSessionContextValue, 'createTerminalWithAdmission'> &
  Partial<Pick<TerminalSessionContextValue, 'createTerminalWithAdmission'>>

export function createTerminalWithAdmissionForContextTest(
  createTerminal: TerminalSessionContextValue['createTerminal'],
  workspacePaneTabs: readonly WorkspacePaneTabEntry[] = [],
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
      workspacePaneTabs: {
        revision: 1,
        entries: [
          {
            repoRoot: base.repoRoot,
            branchName: base.branch,
            worktreePath: base.worktreePath,
            tabs:
              workspacePaneTabs.length > 0
                ? [...workspacePaneTabs]
                : workspacePaneTabsWithRuntimeTab(currentTabs, 'terminal', terminalSessionId, placement),
          },
        ],
      },
      runtimeProjectionApplied: true,
    }
  })
}

export function terminalSessionContextForTest(context: TestTerminalSessionContextValue): TerminalSessionContextValue {
  const createTerminalWithAdmission =
    context.createTerminalWithAdmission ?? createTerminalWithAdmissionForContextTest(context.createTerminal)
  return { ...context, createTerminalWithAdmission }
}
