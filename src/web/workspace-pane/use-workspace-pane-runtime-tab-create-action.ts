import { useCallback, useMemo } from 'react'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  type WorkspacePaneRuntimeTabCreateAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { resolveWorkspacePaneTerminalExecutionTarget } from '#/web/workspace-pane/workspace-pane-terminal-execution-target.ts'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  repoRoot: string
  repoRuntimeId: string
  branchName: string | null
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  workspacePaneRoute: ParsedRepoBranchWorkspacePaneRoute | null | undefined
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    target: RuntimeWorkspacePaneTarget,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction({
  repoRoot,
  repoRuntimeId,
  branchName,
  runtimeTabStateByType,
  workspacePaneRoute,
  showCreatedRuntimeTab,
  t,
}: UseWorkspacePaneRuntimeTabCreateActionInput): WorkspacePaneRuntimeTabCreateAction | null {
  const { createTerminalWithAdmission } = useTerminalSessionContext()
  const terminalBase = useMemo(
    () => resolveWorkspacePaneTerminalExecutionTarget(repoRoot, branchName),
    [branchName, repoRuntimeId, repoRoot],
  )
  const captureOpenerIdentity = useCallback(
    () =>
      captureWorkspacePaneActiveTabIdentity(repoRoot, repoRuntimeId, branchName, {
        workspacePaneRoute,
      }),
    [branchName, repoRoot, repoRuntimeId, workspacePaneRoute],
  )

  return useMemo(
    () =>
      workspacePaneRuntimeTabCreateAction('terminal', {
        runtimeTabStateByType,
        showCreatedRuntimeTab: (type, sessionId, presentation) =>
          terminalBase?.target ? showCreatedRuntimeTab(type, sessionId, presentation, terminalBase.target) : false,
        t,
        terminal: {
          base: terminalBase,
          createTerminal: createTerminalWithAdmission,
          captureOpenerIdentity,
        },
      }),
    [
      captureOpenerIdentity,
      createTerminalWithAdmission,
      runtimeTabStateByType,
      showCreatedRuntimeTab,
      t,
      terminalBase,
    ],
  )
}
