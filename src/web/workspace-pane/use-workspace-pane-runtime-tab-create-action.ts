import { computed, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter } from 'vue'
import type { TerminalPresentation } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useTerminalSessionContext } from '#/web/terminal/components/terminal-session-context.ts'
import type { TerminalCreateTranslator } from '#/web/terminal/components/terminal-create-feedback.ts'
import { captureWorkspacePaneActiveTabIdentity } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import {
  type CreatedTerminalRouteRequest,
  type WorkspacePaneRuntimeTabCreateAction,
  type WorkspacePaneRuntimeTabCreateStateByType,
  workspacePaneRuntimeTabCreateAction,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/app/navigation/route-model.ts'
import {
  workspacePaneLocationTerminalBase,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export interface UseWorkspacePaneRuntimeTabCreateActionInput {
  location: MaybeRefOrGetter<FilesystemWorkspacePaneLocation | null>
  runtimeTabStateByType: MaybeRefOrGetter<WorkspacePaneRuntimeTabCreateStateByType>
  workspacePaneRoute: MaybeRefOrGetter<ParsedWorkspacePaneRoute | null | undefined>
  showCreatedRuntimeTab: (
    type: WorkspacePaneRuntimeTabType,
    sessionId: string,
    presentation: TerminalPresentation,
    routeRequest: CreatedTerminalRouteRequest,
  ) => boolean | Promise<boolean>
  t: TerminalCreateTranslator
}

export function useWorkspacePaneRuntimeTabCreateAction(
  input: UseWorkspacePaneRuntimeTabCreateActionInput,
): ComputedRef<WorkspacePaneRuntimeTabCreateAction | null> {
  const { createTerminalWithAdmission, focusTerminal } = useTerminalSessionContext()
  const captureOpenerIdentity = () => {
    const location = toValue(input.location)
    if (!location) return null
    const terminalBase = workspacePaneLocationTerminalBase(location)
    if (!terminalBase) return null
    return captureWorkspacePaneActiveTabIdentity(location, {
      workspacePaneRoute: toValue(input.workspacePaneRoute),
    })
  }

  return computed(() => {
    const location = toValue(input.location)
    const terminalBase = location ? workspacePaneLocationTerminalBase(location) : null
    return workspacePaneRuntimeTabCreateAction('terminal', {
      runtimeTabStateByType: toValue(input.runtimeTabStateByType),
      showCreatedRuntimeTab: (type, sessionId, presentation, routeRequest) =>
        terminalBase?.target ? input.showCreatedRuntimeTab(type, sessionId, presentation, routeRequest) : false,
      t: input.t,
      terminal: terminalBase
        ? {
            location: location!,
            createTerminal: createTerminalWithAdmission,
            captureOpenerIdentity,
            focusTerminal,
          }
        : undefined,
    })
  })
}
