import { useCallback, useMemo } from 'react'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { EmptyState, ScrollPane } from '#/web/components/Layout.tsx'
import { WorkspaceDirectoryStatus } from '#/web/components/workspace-pane/WorkspaceDirectoryStatus.tsx'
import { WorkspaceFilesystemTabPanel } from '#/web/components/workspace-pane/WorkspaceFilesystemTabPanel.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { WorkspacePaneTargetToolbar } from '#/web/components/workspace-pane/WorkspacePaneTargetToolbar.tsx'
import type { FilesystemWorkspacePaneProjection } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { useWorkspaceDirectoryOverview } from '#/web/workspace-directory-overview-query.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'
import { dispatchOpenWorkspacePaneTargetStaticTabAction } from '#/web/workspace-pane/workspace-pane-tab-open-action.ts'
import { workspaceRootPaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { useWorkspaceRootTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'

export function WorkspaceRootPane({
  workspace,
  workspacePaneId,
  route,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  workspace: FilesystemWorkspacePaneProjection
  workspacePaneId: string
  route: ParsedWorkspacePaneRoute | null
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const navigation = useAppNavigation()
  const model = useWorkspaceRootTabModel(workspace, route)
  useFilesystemWorkspacePaneRouteController({ route, model })
  const target = useMemo(() => ({ kind: 'workspace-root' as const, workspaceId: workspace.id }), [workspace.id])
  const runtimeTarget = runtimeWorkspacePaneTarget(target, workspace.workspaceRuntimeId)
  const activePanel = model.selection?.tab ?? null
  const overviewReadModel = useWorkspaceDirectoryOverview(
    workspace.id,
    workspace.workspaceRuntimeId,
    activePanel === 'status',
  )
  const selectedTerminalSessionId =
    model.selection?.kind === 'materialized-tab' && model.selection.materializedTab.kind === 'runtime'
      ? model.selection.materializedTab.sessionId
      : null
  const surfaceTarget = workspaceRootPaneFilesystemTarget({
    workspaceId: workspace.id,
    workspaceRuntimeId: workspace.workspaceRuntimeId,
    capabilities: workspace.probe.capabilities,
  })
  const openFilesTab = useCallback(() => {
    void dispatchOpenWorkspacePaneTargetStaticTabAction({
      workspaceId: workspace.id,
      routeTarget: target,
      paneTarget: target,
      type: 'files',
      workspacePaneRoute: { kind: 'static', tab: 'status' },
      navigation,
    })
  }, [navigation, target, workspace.id])
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspacePaneTargetToolbar
        target={surfaceTarget}
        model={model}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={route}
        statusCount={0}
        trafficLightOffset={toolbarTrafficLightOffset}
        onBackToNavigator={onBackToNavigator}
        staticTabAvailable={(type) => type === 'status' || type === 'files'}
      />
      {activePanel === 'status' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-status-panel`} label={t('tab.status')}>
          <ScrollPane>
            {overviewReadModel.data ? (
              <WorkspaceDirectoryStatus
                overview={overviewReadModel.data}
                workingDirectory={formatWorkspaceDisplayLocation(workspace.id)}
                onOpenFiles={openFilesTab}
              />
            ) : overviewReadModel.isError ? (
              <div className="p-4 text-sm text-destructive">{t('dashboard.directory.read-failed')}</div>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">{t('dashboard.loading')}</div>
            )}
          </ScrollPane>
        </WorkspacePanePanelFrame>
      ) : activePanel === 'files' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} label={t('tab.files')}>
          <WorkspaceFilesystemTabPanel routeTarget={target} target={surfaceTarget} />
        </WorkspacePanePanelFrame>
      ) : activePanel === 'terminal' && runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            routeTarget: target,
            runtimeTarget,
            presentation: { kind: 'workspace-root' },
          },
          selectedSessionId: selectedTerminalSessionId,
          runtimeState: model.runtimeTabStateByType.terminal,
        })
      ) : (
        <EmptyState title={t('workspace-pane-tabs.empty')} />
      )}
    </section>
  )
}
