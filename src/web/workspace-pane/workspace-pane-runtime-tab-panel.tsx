import { useCallback, type ReactNode } from 'react'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneRuntimeTabType } from '#/shared/workspace-pane.ts'
import { runCreateTerminalTabCommand } from '#/web/commands/terminal-create-command.ts'
import { TerminalSessionView } from '#/web/components/terminal/TerminalSessionView.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspacePaneRuntimeProjectionPhase } from '#/web/workspace-pane/workspace-pane-runtime-state.ts'

export interface WorkspacePaneRuntimeTabPanelState {
  projectionPhase: WorkspacePaneRuntimeProjectionPhase
  projectionErrorMessage?: string
}

export interface WorkspacePaneRuntimeTabPanelTarget {
  repoRoot: string
  repoInstanceId: string
  branchName: string | null
  worktreePath: string | null
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
  const { createTerminal, createOwnedTerminal } = useTerminalSessionContext()
  const navigation = usePrimaryWindowNavigation()
  const createTerminalForSlot = useCallback(
    async (base: TerminalSessionBase) => {
      await runCreateTerminalTabCommand({
        base,
        createTerminal,
        createOwnedTerminal,
        openerIdentity: null,
        showCreatedTerminalTab: (terminalSessionId) =>
          navigation.showRepoBranchTerminalSession(base.repoRoot, base.branch, terminalSessionId),
        t,
        logMessage: 'workspace pane terminal create failed',
      })
    },
    [createOwnedTerminal, createTerminal, navigation, t],
  )

  if (!target.branchName || !target.worktreePath) return null
  return (
    <WorkspacePanePanelFrame id={`${workspacePaneId}-terminal-panel`} {...panelLabel}>
      <TerminalSessionView
        repoRoot={target.repoRoot}
        repoInstanceId={target.repoInstanceId}
        branch={target.branchName}
        worktreePath={target.worktreePath}
        selectedTerminalSessionId={selectedSessionId}
        projectionPhase={runtimeState.projectionPhase}
        projectionErrorMessage={runtimeState.projectionErrorMessage}
        createTerminalForSlot={createTerminalForSlot}
      />
    </WorkspacePanePanelFrame>
  )
}
