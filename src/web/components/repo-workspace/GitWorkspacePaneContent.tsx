import { defineComponent } from 'vue'
import { EmptyState } from '#/web/components/EmptyState.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { renderGitWorkspacePanePanel } from '#/web/components/repo-workspace/panels.tsx'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
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
    'onBackToGitWorkspaceNavigator',
  ],

  setup(props) {
    const t = useT()
    const compact = useIsCompactUi()

    return () => {
      const { branch } = props.detail
      const selection = props.workspacePaneTabModel.selection
      const renderedTab = selection?.tab ?? null
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
            <EmptyState title={t('workspace-pane-tabs.empty')} />
          </div>
        )
      }

      return (
        <div class="flex min-h-0 flex-1 flex-col">
          {renderedTab
            ? renderGitWorkspacePanePanel({
                type: renderedTab,
                repo: props.repo,
                detail: props.detail,
                workspacePaneId: props.workspacePaneId,
                panelLabel,
                model: props.workspacePaneTabModel,
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
      (candidate) =>
        (candidate.kind === 'runtime' || candidate.kind === 'runtime-placeholder') &&
        candidate.runtimeType === tab.runtimeType,
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
