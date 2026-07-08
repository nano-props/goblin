import { useCallback, useMemo } from 'react'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  type WorkspacePaneRuntimeTabCreateAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  repoRoot: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  initialRuntimeProjectionHydrating: boolean
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  showCreatedRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction({
  repoRoot,
  repoRuntimeId,
  branchName,
  worktreePath,
  runtimeTabStateByType,
  initialRuntimeProjectionHydrating,
  workspacePaneRoute,
  showCreatedRuntimeTab,
  t,
}: UseWorkspacePaneRuntimeTabCreateActionInput): WorkspacePaneRuntimeTabCreateAction | null {
  const { createTerminal } = useTerminalSessionContext()
  const terminalBase = useMemo<TerminalSessionBase | null>(
    () =>
      branchName && worktreePath
        ? {
            repoRoot,
            repoRuntimeId,
            branch: branchName,
            worktreePath,
          }
        : null,
    [branchName, repoRuntimeId, repoRoot, worktreePath],
  )
  const captureOpenerIdentity = useCallback(
    () =>
      branchName
        ? captureWorkspacePaneActiveTabIdentity(repoRoot, branchName, {
            workspacePaneRoute,
          })
        : null,
    [branchName, repoRoot, workspacePaneRoute],
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
          captureOpenerIdentity,
        },
      }),
    [
      captureOpenerIdentity,
      createTerminal,
      initialRuntimeProjectionHydrating,
      repoRoot,
      runtimeTabStateByType,
      showCreatedRuntimeTab,
      t,
      terminalBase,
    ],
  )
}
