import { useT } from '#/web/stores/i18n.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import type { RepoWorkspaceRepo, CurrentRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import type {
  RepoWorkspaceTabModel,
  RepoWorkspaceTab,
  RepoWorkspaceSelection,
  RepoWorkspaceRuntimeTabStateByType,
} from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import {
  workspacePaneRuntimeTabProvider,
  workspacePaneStaticTabProvider,
  type WorkspacePanePanelLabel,
} from '#/web/workspace-pane/tab-providers.ts'
import { renderRepoWorkspacePanePanel } from '#/web/components/repo-workspace/panels.tsx'

interface Props {
  repo: Pick<RepoWorkspaceRepo, 'id' | 'instanceId' | 'branchModel' | 'ui'>
  detail: CurrentRepoWorkspacePresentation
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
    runtimeTabStateByType: workspacePaneTabModel.runtimeTabStateByType,
  })
  const noBranchTitleKey = repo.branchModel.branches.length === 0 ? 'branches.empty' : 'branches.filter-empty'
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
            selection,
            runtimeTabStateByType: workspacePaneTabModel.runtimeTabStateByType,
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
  runtimeTabStateByType: RepoWorkspaceRuntimeTabStateByType
}): WorkspacePanePanelLabel {
  const tab = input.selection?.kind === 'materialized-tab' ? input.selection.materializedTab : null
  if (tab?.kind === 'runtime') {
    const provider = workspacePaneRuntimeTabProvider(tab.runtimeType)
    const runtimeTabs = input.tabs.filter(
      (candidate) => candidate.kind === 'runtime' && candidate.runtimeType === tab.runtimeType,
    )
    const index = runtimeTabs.findIndex((candidate) => candidate.identity === tab.identity)
    return {
      labelledById: provider.buttonId(input.workspacePaneId, input.compact ? 0 : Math.max(0, index)),
    }
  }
  if (tab?.kind === 'static') {
    return { labelledById: workspacePaneStaticTabProvider(tab.type).buttonId(input.workspacePaneId) }
  }
  const pendingTab = input.tabs.find((candidate) => candidate.kind === 'pending')
  if (pendingTab) {
    return { labelledById: `${input.workspacePaneId}-${pendingTab.type}-pending-tab` }
  }
  if (input.selection?.kind !== 'runtime-host') return { label: input.t('workspace-pane-tabs.tabs') }
  const runtimeState = input.runtimeTabStateByType[input.selection.runtimeType]
  return {
    label: workspacePaneRuntimeTabProvider(input.selection.runtimeType).pendingLabel({
      t: input.t,
      createPending: runtimeState.createPending,
      projectionPhase: runtimeState.projectionPhase,
    }),
  }
}
