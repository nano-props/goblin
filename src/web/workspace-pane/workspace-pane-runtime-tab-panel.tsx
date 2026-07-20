import { useCallback, type ReactNode } from 'react'
import type { TerminalPresentation, TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import {
  dispatchCreateTerminalWorkspacePaneRuntimeTabAction,
  showCreatedTerminalWorkspacePaneRuntimeTab,
} from '#/web/workspace-pane/workspace-pane-runtime-tab-create-action.ts'
import { TerminalSessionView } from '#/web/components/terminal/TerminalSessionView.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'
import type { RuntimeWorkspacePaneTarget } from '#/shared/workspace-runtime.ts'
import { beginPrimaryWindowPresentation } from '#/web/primary-window-presentation.ts'

export interface WorkspacePaneRuntimeTabPanelState {
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
}

export interface WorkspacePaneRuntimeTabPanelTarget {
  runtimeTarget: RuntimeWorkspacePaneTarget
  presentation: TerminalPresentation
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

type WorkspacePaneRuntimeTabPanelComponent = (props: WorkspacePaneRuntimeTabPanelProps) => ReactNode

const WORKSPACE_PANE_RUNTIME_TAB_PANEL_BY_TYPE: Record<
  WorkspacePaneRuntimeTabType,
  WorkspacePaneRuntimeTabPanelComponent
> = {
  terminal: TerminalWorkspacePaneRuntimeTabPanel,
}

export function renderWorkspacePaneRuntimeTabPanel(input: WorkspacePaneRuntimeTabPanelRenderInput): ReactNode {
  const Panel = WORKSPACE_PANE_RUNTIME_TAB_PANEL_BY_TYPE[input.type]
  return (
    <Panel
      runtimeType={input.type}
      workspacePaneId={input.workspacePaneId}
      panelLabel={input.panelLabel}
      target={input.target}
      selectedSessionId={input.selectedSessionId}
      runtimeState={input.runtimeState}
    />
  )
}

function TerminalWorkspacePaneRuntimeTabPanel({
  workspacePaneId,
  panelLabel,
  target,
  selectedSessionId,
  runtimeState,
}: WorkspacePaneRuntimeTabPanelProps) {
  const t = useT()
  const { createTerminalWithAdmission } = useTerminalSessionContext()
  const navigation = usePrimaryWindowNavigation()
  const createTerminalForSlot = useCallback(
    async (base: TerminalSessionBase) => {
      const presentationToken = beginPrimaryWindowPresentation()
      await dispatchCreateTerminalWorkspacePaneRuntimeTabAction({
        base,
        createTerminal: createTerminalWithAdmission,
        openerIdentity: null,
        showCreatedTerminalTab: (terminalSessionId, presentation) => {
          if (base.target.kind === 'workspace-root' && presentation.kind === 'workspace-root') {
            return showCreatedTerminalWorkspacePaneRuntimeTab(
              { target: base.target, presentation },
              terminalSessionId,
              navigation,
              presentationToken,
            )
          }
          if (base.target.kind === 'git-worktree' && presentation.kind === 'git-worktree') {
            return showCreatedTerminalWorkspacePaneRuntimeTab(
              { target: base.target, presentation },
              terminalSessionId,
              navigation,
              presentationToken,
            )
          }
          return false
        },
        t,
        logMessage: 'workspace pane terminal create failed',
      })
    },
    [createTerminalWithAdmission, navigation, t],
  )

  const { runtimeTarget, presentation } = target
  if (runtimeTarget.kind !== presentation.kind) return null
  const base: TerminalSessionBase | null =
    runtimeTarget.kind === 'workspace-root' && presentation.kind === 'workspace-root'
      ? { target: runtimeTarget, presentation }
      : runtimeTarget.kind === 'git-worktree' && presentation.kind === 'git-worktree'
        ? { target: runtimeTarget, presentation }
        : null
  if (!base) return null
  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-terminal-panel`} {...panelLabel}>
      <TerminalSessionView
        base={base}
        selectedTerminalSessionId={selectedSessionId}
        projectionPhase={runtimeState.projectionPhase}
        projectionErrorMessage={runtimeState.projectionErrorMessage}
        createTerminalForSlot={createTerminalForSlot}
      />
    </WorkspacePanePanelFrame>
  )
}
