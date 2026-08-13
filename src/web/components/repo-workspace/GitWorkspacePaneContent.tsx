import { defineComponent } from 'vue'
import { EmptyState } from '#/web/components/Layout.tsx'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { renderGitWorkspacePanePanel } from '#/web/components/repo-workspace/panels.tsx'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import type { RepoReadFailure } from '#/web/repo-read-failure.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePanePanelLabel } from '#/web/workspace-pane/tab-providers.ts'
import type {
  WorkspacePaneRuntimeTabStateByType,
  WorkspacePaneSelection,
  WorkspacePaneTab,
  WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'

interface GitWorkspacePaneContentProps {
  repo: Pick<GitWorkspacePaneProjection, 'id' | 'workspaceRuntimeId' | 'snapshot' | 'status' | 'ui' | 'probe'>
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneId: string
  workspacePaneTabModel: WorkspacePaneTabModel
  readFailures?: RepoReadFailure[]
  onRetryStatus?: () => void
  onBackToGitWorkspaceNavigator?: () => void
}

// Pure view: the workspace pane body is derived from the workspace store's
// target-scoped preferred tab and live terminal truth.
export const GitWorkspacePaneContent = defineComponent<GitWorkspacePaneContentProps>({
  name: 'GitWorkspacePaneContent',
  props: [
    'repo',
    'detail',
    'workspacePaneId',
    'workspacePaneTabModel',
    'readFailures',
    'onRetryStatus',
    'onBackToGitWorkspaceNavigator',
  ],

  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()

    return () => {
      const { branch } = props.detail
      const selection = props.workspacePaneTabModel.selection
      const renderedTab = selection?.tab ?? null
      const statusFailure: RepoReadFailure | null =
        (renderedTab === 'status' || renderedTab === 'changes') && props.detail.errors.status
          ? {
              message: props.detail.errors.status,
              stale: props.detail.stale.status,
              retrying: props.detail.loading.status,
              retry: props.onRetryStatus,
            }
          : null
      const visibleReadFailures = [...(props.readFailures ?? []), statusFailure].filter((failure) => failure !== null)
      const panelLabel = workspacePanePanelLabel({
        selection,
        tabs: props.workspacePaneTabModel.tabs,
        workspacePaneId: props.workspacePaneId,
        compact: compact.value,
        t,
        runtimeTabStateByType: props.workspacePaneTabModel.runtimeTabStateByType,
      })

      if (!branch) {
        const missingRoutedBranch = props.repo.ui.currentBranchName !== null
        return (
          <div class="flex min-h-0 flex-1 flex-col">
            <RepoReadNotice failures={visibleReadFailures} />
            <EmptyState
              title={t(missingRoutedBranch ? 'branches.missing' : 'branches.empty')}
              body={
                compact.value && missingRoutedBranch && props.onBackToGitWorkspaceNavigator ? (
                  <Button type="button" variant="outline" size="sm" onClick={props.onBackToGitWorkspaceNavigator}>
                    {t('branches.back-to-list')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )
      }

      if (!selection) {
        return (
          <div class="flex min-h-0 flex-1 flex-col">
            <RepoReadNotice failures={visibleReadFailures} />
            <EmptyState title={t('workspace-pane-tabs.empty')} />
          </div>
        )
      }

      return (
        <div class="flex min-h-0 flex-1 flex-col">
          <RepoReadNotice failures={visibleReadFailures} />
          {renderedTab
            ? renderGitWorkspacePanePanel({
                type: renderedTab,
                repo: props.repo,
                detail: props.detail,
                workspacePaneId: props.workspacePaneId,
                panelLabel,
                selection,
                runtimeTabStateByType: props.workspacePaneTabModel.runtimeTabStateByType,
              })
            : null}
        </div>
      )
    }
  },
})

function workspacePanePanelLabel(input: {
  selection: WorkspacePaneSelection | null
  tabs: readonly WorkspacePaneTab[]
  workspacePaneId: string
  compact: boolean
  t: (key: string, params?: Record<string, string | number>) => string
  runtimeTabStateByType: WorkspacePaneRuntimeTabStateByType
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
  if (pendingTab) return { labelledById: `${input.workspacePaneId}-${pendingTab.type}-pending-tab` }
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
