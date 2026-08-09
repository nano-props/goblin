import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalCreateTranslator } from '#/web/components/terminal/terminal-create-feedback.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  type CreatedTerminalRouteRequest,
  type WorkspacePaneRuntimeTabCreateAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  workspacePaneTabsTargetFromRuntime,
  type WorkspacePaneTabsTarget,
} from '#/shared/workspace-pane-tabs-target.ts'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  routeTarget: MaybeRefOrGetter<WorkspacePaneTabsTarget>
  base: MaybeRefOrGetter<TerminalSessionBase | null>
  runtimeTabStateByType: MaybeRefOrGetter<WorkspacePaneRuntimeTabCreateStateByType>
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null | undefined>
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    target: RuntimeWorkspacePaneTarget,
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction(
  input: UseWorkspacePaneRuntimeTabCreateActionInput,
): ComputedRef<WorkspacePaneRuntimeTabCreateAction | null> {
  const { createTerminalWithAdmission, focusTerminal } = useTerminalSessionContext()
  const captureOpenerIdentity = () => {
    const terminalBase = toValue(input.base)
    if (!terminalBase) return null
    const paneTarget = workspacePaneTabsTargetFromRuntime(terminalBase.target)
    return paneTarget
      ? captureWorkspacePaneActiveTabIdentity(paneTarget, terminalBase.target.workspaceRuntimeId, {
          workspacePaneRoute: toValue(input.workspacePaneRoute),
        })
      : null
  }

  return computed(() => {
    const terminalBase = toValue(input.base)
    return workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: toValue(input.runtimeTabStateByType),
      showCreatedRuntimeTab: (type, sessionId, presentation, routeRequest) =>
        terminalBase?.target
          ? input.showCreatedRuntimeTab(type, sessionId, presentation, terminalBase.target, routeRequest)
          : false,
      t: input.t,
      terminal: {
        routeTarget: toValue(input.routeTarget),
        base: terminalBase,
        createTerminal: createTerminalWithAdmission,
        captureOpenerIdentity,
        focusTerminal,
      },
    })
  })
}
