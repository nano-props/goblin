import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import type {
  BranchWorkspaceRepo,
  SelectedBranchWorkspacePresentation,
} from '#/web/components/branch-workspace/model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import type {
  BranchWorkspacePaneTabModel,
  BranchWorkspacePaneTab,
  BranchWorkspacePaneSelection,
} from '#/web/components/branch-workspace/workspace-pane-tab-model.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  type WorkspacePanePanelLabel,
} from '#/web/workspace-pane/workspace-pane-tab-providers.ts'
import { renderBranchWorkspacePanePanel } from '#/web/components/branch-workspace/workspace-pane-panels.tsx'

interface Props {
  repo: Pick<BranchWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: BranchWorkspaceRepo['data'] & Pick<BranchWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedBranchWorkspacePresentation
  workspacePaneId: string
  workspacePaneTabModel: BranchWorkspacePaneTabModel
}

// Pure view: the workspace pane body is derived from the repos store's
// branch-scoped preferred view and the live terminal session truth. The store
// never re-projects on snapshot refresh, branch switch, or session restore.
// The tab model keeps the body render target separate from the active
// materialized tab.
export function BranchWorkspaceContent({ repo, detail, workspacePaneId, workspacePaneTabModel }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const { branch } = detail
  const selection = workspacePaneTabModel.selection
  const renderedView = selection?.view ?? null
  const panelLabel = workspacePanePanelLabel({
    selection,
    tabs: workspacePaneTabModel.tabs,
    workspacePaneId,
    compact,
    t,
    terminalSyncReady: workspacePaneTabModel.terminalSyncReady,
    terminalCreatePending: workspacePaneTabModel.terminalCreatePending,
  })
  const noBranchTitleKey = repo.data.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty'
  if (!branch) return <EmptyState title={t(noBranchTitleKey)} />

  if (!selection) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EmptyState title={t('workspace-pane-views.empty')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderedView
        ? renderBranchWorkspacePanePanel({
            type: renderedView,
            repo,
            detail,
            workspacePaneId,
            panelLabel,
            terminalSyncReady: workspacePaneTabModel.terminalSyncReady,
          })
        : null}
    </div>
  )
}

function workspacePanePanelLabel(input: {
  selection: BranchWorkspacePaneSelection | null
  tabs: readonly BranchWorkspacePaneTab[]
  workspacePaneId: string
  compact: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  terminalSyncReady: boolean
  terminalCreatePending: boolean
}): WorkspacePanePanelLabel {
  const tab = input.selection?.kind === 'materialized-tab' ? input.selection.tab : null
  if (tab?.kind === 'terminal') {
    const terminalTabs = input.tabs.filter((candidate) => candidate.kind === 'terminal')
    const index = terminalTabs.findIndex((candidate) => candidate.identity === tab.identity)
    return {
      labelledById: terminalWorkspacePaneTabProvider.buttonId(
        input.workspacePaneId,
        input.compact ? 0 : Math.max(0, index),
      ),
    }
  }
  if (tab?.kind === 'static') {
    return { labelledById: workspacePaneStaticTabProvider(tab.type).buttonId(input.workspacePaneId) }
  }
  const pendingTab = input.tabs.find((candidate) => candidate.kind === 'pending')
  if (pendingTab) {
    return { labelledById: `${input.workspacePaneId}-${pendingTab.type}-pending-tab` }
  }
  return {
    label: terminalWorkspacePaneTabProvider.pendingLabel({
      t: input.t,
      terminalCreatePending: input.terminalCreatePending,
      terminalSyncReady: input.terminalSyncReady,
    }),
  }
}
