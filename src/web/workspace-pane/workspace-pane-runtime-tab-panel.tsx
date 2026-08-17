import { defineComponent } from 'vue'
import type { VNodeChild } from 'vue'
import type { TerminalPresentation, TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { useAppNavigation } from '#/web/app/navigation/context.tsx'
import { TerminalSessionView } from '#/web/terminal/components/TerminalSessionView.tsx'
import { useTerminalSessionContext } from '#/web/terminal/components/terminal-session-context.ts'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import {
  dispatchCreateTerminalWorkspacePaneRuntimeTabAction,
  showCreatedTerminalWorkspacePaneRuntimeTab,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import { useTerminalProjectionRecoveryActions } from '#/web/runtime/terminal-projection-recovery-context.ts'
import {
  workspacePaneLocationTerminalBase,
  type FilesystemWorkspacePaneLocation,
} from '#/web/workspace-pane/workspace-pane-location.ts'

export interface WorkspacePaneRuntimeTabPanelState {
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
}

export interface WorkspacePaneRuntimeTabPanelTarget {
  location: FilesystemWorkspacePaneLocation
}

export interface WorkspacePaneRuntimeTabPanelRenderInput {
  type: WorkspacePaneRuntimeTabType
  workspacePaneId: string
  panelLabel: WorkspacePanePanelLabel
  target: WorkspacePaneRuntimeTabPanelTarget
  selectedSessionId: string | null
  runtimeState: WorkspacePaneRuntimeTabPanelState
}

interface WorkspacePaneRuntimeTabPanelProps extends Omit<WorkspacePaneRuntimeTabPanelRenderInput, 'type'> {
  runtimeType: WorkspacePaneRuntimeTabType
}

const TerminalWorkspacePaneRuntimeTabPanel = defineComponent<WorkspacePaneRuntimeTabPanelProps>({
  name: 'TerminalWorkspacePaneRuntimeTabPanel',
  props: ['runtimeType', 'workspacePaneId', 'panelLabel', 'target', 'selectedSessionId', 'runtimeState'],

  setup(props) {
    const t = useT()
    const { createTerminalWithAdmission, focusTerminal } = useTerminalSessionContext()
    const navigation = useAppNavigation()
    const projectionRecovery = useTerminalProjectionRecoveryActions()

    const createTerminalForSlot = async (base: TerminalSessionBase) => {
      await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        location: props.target.location,
        createTerminal: createTerminalWithAdmission,
        openerIdentity: null,
        showCreatedTerminalTab: (terminalSessionId, presentation, routeRequest) => {
          if (base.target.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
            return showCreatedTerminalWorkspacePaneRuntimeTab(
              props.target.location,
              presentation,
              terminalSessionId,
              navigation,
              routeRequest,
            )
          }
          if (base.target.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
            return showCreatedTerminalWorkspacePaneRuntimeTab(
              props.target.location,
              presentation,
              terminalSessionId,
              navigation,
              routeRequest,
            )
          }
          return false
        },
        focusTerminal,
        t,
        logMessage: 'workspace pane terminal create failed',
      })
    }

    return () => {
      const base = workspacePaneLocationTerminalBase(props.target.location)
      if (!base) return null
      return (
        <WorkspacePanePanelFrame id={`${props.workspacePaneId}-terminal-panel`} {...props.panelLabel}>
          <TerminalSessionView
            base={base}
            selectedTerminalSessionId={props.selectedSessionId}
            projectionPhase={props.runtimeState.projectionPhase}
            projectionErrorMessage={props.runtimeState.projectionErrorMessage}
            retryProjection={() => projectionRecovery.retryWorkspace(base.target.workspaceId)}
            createTerminalForSlot={createTerminalForSlot}
          />
        </WorkspacePanePanelFrame>
      )
    }
  },
})

export function renderWorkspacePaneRuntimeTabPanel(input: WorkspacePaneRuntimeTabPanelRenderInput): VNodeChild {
  return (
    <TerminalWorkspacePaneRuntimeTabPanel
      runtimeType={input.type}
      workspacePaneId={input.workspacePaneId}
      panelLabel={input.panelLabel}
      target={input.target}
      selectedSessionId={input.selectedSessionId}
      runtimeState={input.runtimeState}
    />
  )
}
