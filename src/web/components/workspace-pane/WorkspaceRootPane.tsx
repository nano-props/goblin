import { computed, defineComponent } from 'vue'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { WorkspaceDirectoryStatus } from '#/web/components/workspace-pane/WorkspaceDirectoryStatus.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import type { FilesystemWorkspacePaneProjection } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useWorkspaceDirectoryOverview } from '#/web/workspace-directory-overview-query.ts'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { dispatchOpenWorkspacePaneTargetStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { useWorkspaceRootTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'

interface WorkspaceRootPaneProps {
  workspace: FilesystemWorkspacePaneProjection
  workspacePaneId: string
  route: ParsedWorkspacePaneRoute | null
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}

export const WorkspaceRootPane = defineComponent<WorkspaceRootPaneProps>({
  name: 'WorkspaceRootPane',
  props: ['workspace', 'workspacePaneId', 'route', 'toolbarTrafficLightOffset', 'onBackToNavigator'],

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()
    const model = useWorkspaceRootTabModel(
      () => props.workspace,
      () => props.route,
    )
    useFilesystemWorkspacePaneRouteController({ route: () => props.route, model })
    const target = computed(() => ({ kind: 'workspace-root' as const, workspaceId: props.workspace.id }))
    const runtimeTarget = computed(() => runtimeWorkspacePaneTarget(target.value, props.workspace.workspaceRuntimeId))
    const activePanel = computed(() => model.value.selection?.tab ?? null)
    const surfaceTarget = computed(() =>
      workspaceRootPaneFilesystemTarget({
        workspaceId: props.workspace.id,
        workspaceRuntimeId: props.workspace.workspaceRuntimeId,
        capabilities: props.workspace.probe.capabilities,
      }),
    )

    const openFilesTab = () => {
      void dispatchOpenWorkspacePaneTargetStaticTabAction({
        workspaceId: props.workspace.id,
        routeTarget: target.value,
        paneTarget: target.value,
        type: 'files',
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        navigation,
      })
    }

    return () => {
      const currentModel = model.value
      const currentActivePanel = activePanel.value
      const selectedTerminalSessionId =
        currentModel.selection?.kind === 'materialized-tab' && currentModel.selection.materializedTab.kind === 'runtime'
          ? currentModel.selection.materializedTab.sessionId
          : null

      return (
        <section class="flex min-h-0 flex-1 flex-col bg-background">
          <WorkspacePaneTargetToolbar
            target={surfaceTarget.value}
            model={currentModel}
            workspacePaneId={props.workspacePaneId}
            workspacePaneRoute={props.route}
            statusCount={0}
            trafficLightOffset={props.toolbarTrafficLightOffset}
            onBackToNavigator={props.onBackToNavigator}
            staticTabAvailable={(type) => type === 'status' || type === 'files'}
          />
          {currentActivePanel === 'status' ? (
            <WorkspaceRootStatusPanel
              workspaceId={props.workspace.id}
              workspaceRuntimeId={props.workspace.workspaceRuntimeId}
              workspacePaneId={props.workspacePaneId}
              onOpenFiles={openFilesTab}
            />
          ) : currentActivePanel === 'files' ? (
            <WorkspacePanePanelFrame id={`${props.workspacePaneId}-files-panel`} label={t('tab.files')}>
              <WorkspaceFilesystemTabPanel routeTarget={target.value} target={surfaceTarget.value} />
            </WorkspacePanePanelFrame>
          ) : currentActivePanel === 'terminal' && runtimeTarget.value ? (
            renderWorkspacePaneRuntimeTabPanel({
              type: 'terminal',
              workspacePaneId: props.workspacePaneId,
              panelLabel: { label: t('tab.terminal') },
              target: {
                routeTarget: target.value,
                runtimeTarget: runtimeTarget.value,
                presentation: { kind: 'workspace-root' },
              },
              selectedSessionId: selectedTerminalSessionId,
              runtimeState: currentModel.runtimeTabStateByType.terminal,
            })
          ) : (
            <EmptyState title={t('workspace-pane-tabs.empty')} />
          )}
        </section>
      )
    }
  },
})

const WorkspaceRootStatusPanel = defineComponent<{
  workspaceId: FilesystemWorkspacePaneProjection['id']
  workspaceRuntimeId: string
  workspacePaneId: string
  onOpenFiles: () => void
}>({
  name: 'WorkspaceRootStatusPanel',
  props: ['workspaceId', 'workspaceRuntimeId', 'workspacePaneId', 'onOpenFiles'],

  setup(props) {
    const t = useT()
    const overviewReadModel = useWorkspaceDirectoryOverview(
      () => props.workspaceId,
      () => props.workspaceRuntimeId,
      true,
    )

    return () => (
      <WorkspacePanePanelFrame id={`${props.workspacePaneId}-status-panel`} label={t('tab.status')}>
        <ScrollPane>
          {overviewReadModel.data.value ? (
            <WorkspaceDirectoryStatus
              overview={overviewReadModel.data.value}
              workingDirectory={formatWorkspaceDisplayLocation(props.workspaceId)}
              onOpenFiles={props.onOpenFiles}
            />
          ) : overviewReadModel.isError.value ? (
            <div class="p-4 text-sm text-destructive">{t('dashboard.directory.read-failed')}</div>
          ) : (
            <div class="p-4 text-sm text-muted-foreground">{t('dashboard.loading')}</div>
          )}
        </ScrollPane>
      </WorkspacePanePanelFrame>
    )
  },
})
