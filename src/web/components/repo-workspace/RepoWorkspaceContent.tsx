import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import type { RepoWorkspaceRepo, SelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import type {
  RepoWorkspaceTabModel,
  RepoWorkspaceTab,
  RepoWorkspaceSelection,
} from '#/web/components/repo-workspace/tab-model.ts'
import {
  terminalWorkspacePaneTabProvider,
  workspacePaneStaticTabProvider,
  type WorkspacePanePanelLabel,
} from '#/web/components/workspace-pane/tab-providers.ts'
import { renderRepoWorkspacePanePanel } from '#/web/components/repo-workspace/panels.tsx'

interface Props {
  repo: Pick<RepoWorkspaceRepo, 'id' | 'data' | 'ui'> & {
    data: RepoWorkspaceRepo['data'] & Pick<RepoWorkspaceRepo['data'], 'statusLoaded'>
  }
  detail: SelectedRepoWorkspacePresentation
  workspacePaneId: string
  workspacePaneTabModel: RepoWorkspaceTabModel
}

// Pure view: the workspace pane body is derived from the repos store's
// target-scoped preferred tab and the live terminal session truth. The store
// never re-projects on snapshot refresh, branch switch, or session restore.
// The tab model keeps the body render target separate from the active
// materialized tab.
export function RepoWorkspaceContent({ repo, detail, workspacePaneId, workspacePaneTabModel }: Props) {
  const t = useT()
  const compact = useIsCompactUi()
  const { branch } = detail
  const selection = workspacePaneTabModel.selection
  const renderedTab = selection?.tab ?? null
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
        <EmptyState title={t('workspace-pane-tabs.empty')} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {renderedTab
        ? renderRepoWorkspacePanePanel({
            type: renderedTab,
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
  selection: RepoWorkspaceSelection | null
  tabs: readonly RepoWorkspaceTab[]
  workspacePaneId: string
  compact: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  terminalSyncReady: boolean
  terminalCreatePending: boolean
}): WorkspacePanePanelLabel {
  const tab = input.selection?.kind === 'materialized-tab' ? input.selection.materializedTab : null
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
