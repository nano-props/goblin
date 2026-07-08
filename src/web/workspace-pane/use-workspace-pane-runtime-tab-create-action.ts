import { useMemo } from 'react'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import {
  type WorkspacePaneRuntimeTabCreateAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  repoRoot: string
  repoInstanceId: string
  branchName: string | null
  worktreePath: string | null
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  initialRuntimeProjectionHydrating: boolean
  openerIdentity: string | null
  showCreatedRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => void
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction({
  repoRoot,
  repoInstanceId,
  branchName,
  worktreePath,
  runtimeTabStateByType,
  initialRuntimeProjectionHydrating,
  openerIdentity,
  showCreatedRuntimeTab,
  t,
}: UseWorkspacePaneRuntimeTabCreateActionInput): WorkspacePaneRuntimeTabCreateAction | null {
  const { createTerminal } = useTerminalSessionContext()
  const terminalBase = useMemo<TerminalSessionBase | null>(
    () =>
      branchName && worktreePath
        ? {
            repoRoot,
            repoInstanceId,
            branch: branchName,
            worktreePath,
          }
        : null,
    [branchName, repoInstanceId, repoRoot, worktreePath],
  )

  return useMemo(
    () =>
      workspacePaneRuntimeTabCreateAction('terminal', {
        repoRoot,
        runtimeTabStateByType,
        initialRuntimeProjectionHydrating,
        showCreatedRuntimeTab,
        t,
        terminal: {
          base: terminalBase,
          createTerminal,
          openerIdentity,
        },
      }),
    [
      createTerminal,
      initialRuntimeProjectionHydrating,
      openerIdentity,
      repoRoot,
      runtimeTabStateByType,
      showCreatedRuntimeTab,
      t,
      terminalBase,
    ],
  )
}
