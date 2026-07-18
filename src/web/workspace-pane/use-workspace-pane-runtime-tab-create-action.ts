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
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { workspacePaneTabsTargetFromRuntime } from '#/shared/workspace-pane-tabs-target.ts'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  base: TerminalSessionBase | null
  runtimeTabStateByType: WorkspacePaneRuntimeTabCreateStateByType
  workspacePaneRoute: ParsedWorkspacePaneRoute | null | undefined
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    target: RuntimeWorkspacePaneTarget,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction({
  base,
  runtimeTabStateByType,
  workspacePaneRoute,
  showCreatedRuntimeTab,
  t,
}: UseWorkspacePaneRuntimeTabCreateActionInput): WorkspacePaneRuntimeTabCreateAction | null {
  const { createTerminalWithAdmission } = useTerminalSessionContext()
  const terminalBase = base
  const captureOpenerIdentity = useCallback(
    () => {
      if (!terminalBase) return null
      const paneTarget = workspacePaneTabsTargetFromRuntime(terminalBase.target)
      return paneTarget
        ? captureWorkspacePaneActiveTabIdentity(paneTarget, terminalBase.target.workspaceRuntimeId, {
            workspacePaneRoute,
          })
        : null
    },
    [terminalBase, workspacePaneRoute],
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
